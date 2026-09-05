import { describe, it, expect, beforeEach } from "vitest";
import { ToolExecutor } from "../src/executor.js";
import { ToolRegistry } from "../src/registry.js";
import { AgentTool, ToolContext } from "../src/interfaces.js";
import { TimeoutError, TaskCancelledError } from "@comu/shared";

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
