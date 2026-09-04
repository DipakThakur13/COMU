import { describe, it, expect } from "vitest";
import { SubagentManager } from "../src/subagent_manager.js";
import { ToolRegistry, ToolExecutor, ToolContext } from "@comu/tool-core";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";

class ScriptableModel implements ModelProvider {
  id = "mock-model";
  name = "Mock";
  public responses: ModelResponse[] = [];

  getCapabilities() {
    return {
      toolCalling: true,
      streaming: false,
      reasoning: false,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 1000
    };
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    const res = this.responses.shift();
    if (!res) return { text: "Worker complete" };
    return res;
  }
}

describe("Supervised Worker Subagents", () => {
  const fakeContext: ToolContext = {
    taskId: "parent-task-1",
    workspace: { rootPath: "/test/workspace" }
  };

  it("should enforce maximum subagent depth = 1 (no recursive subagents)", async () => {
    const manager = new SubagentManager();
    const model = new ScriptableModel();
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry);

    const result = await manager.executeSubagent({
      parentTaskId: "parent-1",
      type: "RESEARCH",
      depth: 2, // Recursive depth
      goal: "Search files",
      model,
      registry,
      executor,
      toolContext: fakeContext,
      onEvent: () => {}
    });

    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("FORBIDDEN_RECURSIVE_SUBAGENT");
  });

  it("should deny write capabilities to research worker agent", async () => {
    const manager = new SubagentManager();
    const model = new ScriptableModel();
    const registry = new ToolRegistry();

    // Register write tool
    let writeCalled = false;
    registry.register({
      name: "write_file",
      description: "write",
      capabilities: ["write"],
      inputSchema: {},
      execute: async () => {
        writeCalled = true;
        return { status: "ok" };
      }
    });

    // Model attempts to call write_file from research worker
    model.responses = [
      {
        text: "Attempting write",
        toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "src/bad.ts" } }]
      },
      { text: "Done" }
    ];

    const executor = new ToolExecutor(registry);
    const result = await manager.executeSubagent({
      parentTaskId: "parent-2",
      type: "RESEARCH",
      depth: 1,
      goal: "Investigate without write",
      model,
      registry,
      executor,
      toolContext: fakeContext,
      onEvent: () => {}
    });

    expect(writeCalled).toBe(false); // Tool was never executed!
    expect(result.status).toBe("COMPLETED");
  });

  it("should execute read-only research tool calls and return structured findings", async () => {
    const manager = new SubagentManager();
    const model = new ScriptableModel();
    const registry = new ToolRegistry();

    registry.register({
      name: "search_text",
      description: "search",
      capabilities: ["read"],
      inputSchema: {},
      execute: async () => [{ file: "src/auth.ts", line: 12 }]
    });

    model.responses = [
      {
        text: "Searching auth tokens",
        toolCalls: [{ id: "c1", name: "search_text", arguments: { query: "token" } }]
      },
      { text: "Found token validation in src/auth.ts" }
    ];

    const executor = new ToolExecutor(registry);
    const result = await manager.executeSubagent({
      parentTaskId: "parent-3",
      type: "RESEARCH",
      depth: 1,
      goal: "Find token validation",
      model,
      registry,
      executor,
      toolContext: fakeContext,
      onEvent: () => {}
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.summary).toContain("Found token validation");
    expect(result.usage.toolCalls).toBe(1);
    expect(result.usage.steps).toBe(2);
  });

  it("should cancel worker cleanly when parent cancellation signal fires", async () => {
    const manager = new SubagentManager();
    const model = new ScriptableModel();
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry);

    const abortController = new AbortController();
    abortController.abort(); // Pre-aborted

    const result = await manager.executeSubagent({
      parentTaskId: "parent-4",
      type: "RESEARCH",
      depth: 1,
      goal: "Cancelled worker",
      parentSignal: abortController.signal,
      model,
      registry,
      executor,
      toolContext: fakeContext,
      onEvent: () => {}
    });

    expect(result.status).toBe("CANCELLED");
  });

  it("should enforce max subagents per task limit", async () => {
    const manager = new SubagentManager({ maxSubagentsPerTask: 1 });
    const model = new ScriptableModel();
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry);

    // First subagent succeeds
    await manager.executeSubagent({
      parentTaskId: "parent-5",
      type: "RESEARCH",
      depth: 1,
      goal: "Worker 1",
      model,
      registry,
      executor,
      toolContext: fakeContext,
      onEvent: () => {}
    });

    // Second subagent exceeds limit
    const res2 = await manager.executeSubagent({
      parentTaskId: "parent-5",
      type: "RESEARCH",
      depth: 1,
      goal: "Worker 2",
      model,
      registry,
      executor,
      toolContext: fakeContext,
      onEvent: () => {}
    });

    expect(res2.status).toBe("LIMIT_REACHED");
    expect(res2.error).toContain("SUBAGENT_LIMIT_REACHED");
  });
});
