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
});
