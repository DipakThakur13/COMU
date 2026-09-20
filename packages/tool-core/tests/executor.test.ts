import { describe, it, expect, beforeEach } from "vitest";
import { ToolExecutor } from "../src/executor.js";
import { ToolRegistry } from "../src/registry.js";
import { AgentTool, ToolContext } from "../src/interfaces.js";
import { TimeoutError, TaskCancelledError, ToolError } from "@comu/shared";

describe("ToolExecutor", () => {
  let registry: ToolRegistry;
  let executor: ToolExecutor;
  let dummyContext: ToolContext;

  beforeEach(() => {
    registry = new ToolRegistry();
    executor = new ToolExecutor(registry);
    dummyContext = {
      taskId: "test-task",
      workspace: { rootPath: "/test" },
      limits: {}
    };
  });

  it("should execute a tool successfully", async () => {
    const mockTool: AgentTool = {
      name: "fast_tool",
      description: "",
      capabilities: [],
      inputSchema: {},
      execute: async (args) => `success ${args.x}`
    };
    registry.register(mockTool);

    const result = await executor.execute("fast_tool", { x: 42 }, dummyContext);
    expect(result).toBe("success 42");
  });

  it("should respect timeouts", async () => {
    const mockTool: AgentTool = {
      name: "slow_tool",
      description: "",
      capabilities: [],
      inputSchema: {},
      execute: async () => new Promise(resolve => setTimeout(() => resolve("done"), 100))
    };
    registry.register(mockTool);

    const contextWithTimeout: ToolContext = {
      ...dummyContext,
      limits: { timeoutMs: 10 }
    };

    await expect(executor.execute("slow_tool", {}, contextWithTimeout)).rejects.toThrow(TimeoutError);
  });

  it("should respect cancellation signal before start", async () => {
    const mockTool: AgentTool = {
      name: "cancel_tool",
      description: "",
      capabilities: [],
      inputSchema: {},
      execute: async () => "done"
    };
    registry.register(mockTool);

    const cancelledContext: ToolContext = {
      ...dummyContext,
      cancellation: { isCancelled: true, onCancel: () => {} }
    };

    await expect(executor.execute("cancel_tool", {}, cancelledContext)).rejects.toThrow(TaskCancelledError);
  });

  describe("timeout and cancellation scope", () => {
    it("normal path with a timeout configured returns the tool result and clears the timer", async () => {
      registry.register({
        name: "quick_tool",
        description: "",
        capabilities: [],
        inputSchema: {},
        execute: async () => "quick"
      });
      const result = await executor.execute("quick_tool", {}, { ...dummyContext, limits: { timeoutMs: 1000 } });
      expect(result).toBe("quick");
    });

    it("on timeout the tool is told to stop through the context it received", async () => {
      let sawAbort = false;
      let sawCancellation = false;
      registry.register({
        name: "listening_tool",
        description: "",
        capabilities: [],
        inputSchema: {},
        execute: (_args, ctx) => new Promise((resolve) => {
          ctx.abortSignal?.addEventListener("abort", () => { sawAbort = true; resolve("stopped"); });
          ctx.cancellation?.onCancel(() => { sawCancellation = true; });
        })
      });

      await expect(executor.execute("listening_tool", {}, { ...dummyContext, limits: { timeoutMs: 10 } })).rejects.toThrow(TimeoutError);
      await new Promise(r => setTimeout(r, 5));
      expect(sawAbort).toBe(true);
      expect(sawCancellation).toBe(true);
    });

    it("a tool that ignores the timeout and later rejects never becomes an unhandled rejection", async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
      process.on("unhandledRejection", onUnhandled);
      try {
        registry.register({
          name: "stubborn_tool",
          description: "",
          capabilities: [],
          inputSchema: {},
          execute: async () => {
            await new Promise(r => setTimeout(r, 30));
            throw new Error("late failure");
          }
        });
        await expect(executor.execute("stubborn_tool", {}, { ...dummyContext, limits: { timeoutMs: 5 } })).rejects.toThrow(TimeoutError);
        await new Promise(r => setTimeout(r, 60));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });

    it("parent abort during execution propagates to the tool and rejects with the tool's error", async () => {
      const parent = new AbortController();
      registry.register({
        name: "abortable_tool",
        description: "",
        capabilities: [],
        inputSchema: {},
        execute: (_args, ctx) => new Promise((_resolve, reject) => {
          ctx.abortSignal?.addEventListener("abort", () => reject(new TaskCancelledError("tool saw abort")));
        })
      });
      const pending = executor.execute("abortable_tool", {}, { ...dummyContext, abortSignal: parent.signal, limits: { timeoutMs: 5000 } });
      setTimeout(() => parent.abort(), 10);
      await expect(pending).rejects.toThrow(TaskCancelledError);
    });

    it("parent cancellation signal during execution propagates to the tool", async () => {
      let cancel: (() => void) | undefined;
      const parentCancellation = {
        isCancelled: false,
        onCancel: (cb: () => void) => { cancel = cb; }
      };
      registry.register({
        name: "cancellable_tool",
        description: "",
        capabilities: [],
        inputSchema: {},
        execute: (_args, ctx) => new Promise((_resolve, reject) => {
          ctx.cancellation?.onCancel(() => reject(new TaskCancelledError("tool saw cancellation")));
        })
      });
      const pending = executor.execute("cancellable_tool", {}, { ...dummyContext, cancellation: parentCancellation, limits: { timeoutMs: 5000 } });
      setTimeout(() => cancel?.(), 10);
      await expect(pending).rejects.toThrow(TaskCancelledError);
    });

    it("an already-aborted parent signal rejects before the tool runs", async () => {
      let ran = false;
      registry.register({
        name: "never_tool",
        description: "",
        capabilities: [],
        inputSchema: {},
        execute: async () => { ran = true; return "ran"; }
      });
      const parent = new AbortController();
      parent.abort();
      await expect(executor.execute("never_tool", {}, { ...dummyContext, abortSignal: parent.signal })).rejects.toThrow(TaskCancelledError);
      expect(ran).toBe(false);
    });

    it("wraps non-Error throws in ToolError", async () => {
      registry.register({
        name: "string_thrower",
        description: "",
        capabilities: [],
        inputSchema: {},
        execute: async () => { throw "plain string"; }
      });
      await expect(executor.execute("string_thrower", {}, dummyContext)).rejects.toBeInstanceOf(ToolError);
      await expect(executor.execute("string_thrower", {}, { ...dummyContext, limits: { timeoutMs: 1000 } })).rejects.toBeInstanceOf(ToolError);
    });
  });

  it("should throw if permission denied", async () => {
    const mockTool: AgentTool = {
      name: "secure_tool",
      description: "",
      capabilities: ["write"],
      inputSchema: {},
      execute: async () => "done"
    };
    registry.register(mockTool);

    const noPermContext: ToolContext = {
      ...dummyContext,
      permissions: { capabilities: { read: "ALLOW", write: "DENY", execute: "DENY", network: "DENY" } }
    };

    await expect(executor.execute("secure_tool", {}, noPermContext)).rejects.toThrow();
  });

  describe("processModelToolCall (Batch 3)", () => {
    beforeEach(() => {
      registry.register({
        name: "edit_file",
        description: "",
        capabilities: ["write"],
        inputSchema: {},
        execute: async () => "edited"
      });
      registry.register({
        name: "read_file",
        description: "",
        capabilities: ["read"],
        inputSchema: {},
        execute: async () => "read"
      });
      registry.register({
        name: "create_file",
        description: "",
        capabilities: ["write"],
        inputSchema: {},
        execute: async () => "created"
      });
    });

    it("TEST F: ASK + valid edit_file call -> REJECTED", async () => {
      const rawInput = { id: "1", name: "edit_file", arguments: {} };
      const validateContract = () => ({ valid: false, reason: "Write/Execute tools are forbidden in ASK mode." });
      
      const res = await executor.processModelToolCall(rawInput, validateContract, dummyContext);
      expect(res.type).toBe("error");
      expect(res.error).toContain("CONTRACT_REJECTED");
    });

    it("TEST G: PLAN + valid create_file call -> REJECTED", async () => {
      const rawInput = { id: "2", name: "create_file", arguments: {} };
      const validateContract = () => ({ valid: false, reason: "Write/Execute tools are forbidden in PLAN mode." });
      
      const res = await executor.processModelToolCall(rawInput, validateContract, dummyContext);
      expect(res.type).toBe("error");
      expect(res.error).toContain("CONTRACT_REJECTED");
    });

    it("TEST H: CHAT + valid tool call -> REJECTED", async () => {
      const rawInput = { id: "3", name: "read_file", arguments: {} };
      const validateContract = () => ({ valid: false, reason: "No tools can be executed in CHAT mode." });
      
      const res = await executor.processModelToolCall(rawInput, validateContract, dummyContext);
      expect(res.type).toBe("error");
      expect(res.error).toContain("CONTRACT_REJECTED");
    });

    it("TEST I: AGENT + authorized read tool -> execution", async () => {
      const rawInput = { id: "4", name: "read_file", arguments: {} };
      const validateContract = () => ({ valid: true });
      
      const res = await executor.processModelToolCall(rawInput, validateContract, dummyContext);
      expect(res.type).toBe("success");
      expect(res.result).toBe("read");
    });

    it("TEST K: unknown tool -> REJECTED", async () => {
      const rawInput = { id: "5", name: "unknown_tool", arguments: {} };
      const validateContract = () => ({ valid: true });
      
      const res = await executor.processModelToolCall(rawInput, validateContract, dummyContext);
      expect(res.type).toBe("error");
      expect(res.error).toContain("UNKNOWN_TOOL");
    });

    it("TEST J: execution trace preserves toolCallId", async () => {
      const rawInput = { id: "trace_123", name: "read_file", arguments: {} };
      const validateContract = () => ({ valid: true });
      
      const traces: string[] = [];
      const tracingContext: ToolContext = {
        ...dummyContext,
        onTrace: (event, callId) => {
          traces.push(`${event}:${callId}`);
        }
      };

      await executor.processModelToolCall(rawInput, validateContract, tracingContext);
      expect(traces).toContain("TOOL_REQUEST:trace_123");
      expect(traces).toContain("VALIDATION_STARTED:trace_123");
      expect(traces).toContain("VALIDATION_COMPLETED:trace_123");
      expect(traces).toContain("TOOL_STARTED:trace_123");
      expect(traces).toContain("TOOL_COMPLETED:trace_123");
    });
  });
});
