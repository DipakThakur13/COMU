import { describe, it, expect } from "vitest";
import { AgentOrchestrator, OrchestratorContext } from "../src/orchestrator.js";
import { InteractionManager } from "../src/interaction_manager.js";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";
import { ToolExecutor, ToolRegistry } from "@comu/tool-core";
import { ComuDiffEngine } from "@comu/diff-engine";

class MockModel implements ModelProvider {
  id = "mock";
  name = "Mock";

  public responses: ModelResponse[] = [];

  getCapabilities() {
    return {
      toolCalling: true,
      streaming: false,
      reasoning: false,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 100
    };
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    const res = this.responses.shift();
    if (!res) {
      return { text: "Default completion" };
    }
    return res;
  }
}

describe("Agent Orchestrator M6", () => {
  it("should complete a documentation task where verification is skipped by policy", async () => {
    const model = new MockModel();
    model.responses = [{ text: "Updated README.md content" }];

    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry);
    const diffEngine = new ComuDiffEngine();

    const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine);

    const events: any[] = [];
    const ctx: OrchestratorContext = {
      taskId: "t1",
      workspaceRoot: "/fake",
      systemPrompt: "sys",
      userPrompt: "Update the README.md documentation",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 5000 },
      onEvent: e => events.push(e)
    };

    const res = await orchestrator.run(ctx);

    expect(res.status).toBe("completed");
    expect(res.finalText).toBe("Updated README.md content");
    expect(res.plan).toBeDefined();

    expect(events.find(e => e.type === "plan.created")).toBeDefined();
    expect(events.find(e => e.type === "task.completed")).toBeDefined();
  });

  it("should pass completion gate when required validation checks pass", async () => {
    const model = new MockModel();
    model.responses = [
      { text: "", toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "src/calc.ts", content: "export const x = 1;" } }] },
      { text: "Implementation complete" }
    ];

    const registry = new ToolRegistry();
    registry.register({
      name: "write_file",
      description: "write",
      capabilities: ["write"],
      inputSchema: {},
      execute: async () => ({ status: "ok" })
    });
    registry.register({
      name: "read_file",
      description: "read",
      capabilities: ["read"],
      inputSchema: {},
      execute: async () => ({ content: "export const x = 1;", hash: "hash-1" })
    });
    // Passing validators
    registry.register({
      name: "run_typecheck",
      description: "typecheck",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({ status: "PASS", exitCode: 0, stdout: "Typecheck passed" })
    });
    registry.register({
      name: "run_tests",
      description: "tests",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({ status: "PASS", exitCode: 0, stdout: "1 test passed" })
    });

    const executor = new ToolExecutor(registry);
    const diffEngine = new ComuDiffEngine();
    const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine);

    const events: any[] = [];
    const ctx: OrchestratorContext = {
      taskId: "t2",
      workspaceRoot: "/fake",
      systemPrompt: "sys",
      userPrompt: "Implement calculator in src/calc.ts",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 5000 },
      onEvent: e => events.push(e)
    };

    const res = await orchestrator.run(ctx);

    expect(res.status).toBe("completed");
    expect(res.verificationResult?.status).toBe("PASSED");
    expect(res.workspaceIntegrity?.status).toBe("VERIFIED");
    expect(events.find(e => e.type === "verification.completed")).toBeDefined();
    expect(events.find(e => e.type === "task.completed")).toBeDefined();
  });

  it("should fail task if required verification is unavailable", async () => {
    const model = new MockModel();
    model.responses = [{ text: "Done without test runner" }];

    const registry = new ToolRegistry();
    // No run_tests registered!
    const executor = new ToolExecutor(registry);
    const orchestrator = new AgentOrchestrator(model, registry, executor, new ComuDiffEngine());

    const ctx: OrchestratorContext = {
      taskId: "t3",
      workspaceRoot: "/fake",
      systemPrompt: "sys",
      userPrompt: "Fix the failing tests",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 5000 },
      onEvent: () => {}
    };

    const res = await orchestrator.run(ctx);
    expect(res.status).toBe("failed");
    expect(res.verificationResult?.status).toBe("UNAVAILABLE");
  });

  it("should support InteractionManager pausing and resuming", async () => {
    const interactionManager = new InteractionManager(1000);
    const events: any[] = [];

    const inputPromise = interactionManager.requestInput(
      "task-interact",
      "Choose Strategy",
      "Which approach should we use?",
      ["JWT", "Session"],
      1000,
      e => events.push(e)
    );

    const pending = interactionManager.getPendingInteraction("task-interact");
    expect(pending).toBeDefined();
    expect(pending?.title).toBe("Choose Strategy");
    expect(events.find(e => e.type === "interaction.requested")).toBeDefined();

    // User responds
    const resolved = interactionManager.resolveInteraction(
      "task-interact",
      pending!.interactionId,
      { type: "INPUT", value: "JWT" },
      e => events.push(e)
    );

    expect(resolved).toBe(true);
    const choice = await inputPromise;
    expect(choice).toBe("JWT");
    expect(events.find(e => e.type === "interaction.responded")).toBeDefined();
  });

  it("should complete an informational query with clean finalText and 1-step plan", async () => {
    const model = new MockModel();
    model.responses = [{ text: "<think>Thinking about C++</think>Here is C++ sample code:\n```cpp\nint main() { return 0; }\n```" }];

    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry);
    const diffEngine = new ComuDiffEngine();

    const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine);

    const events: any[] = [];
    const ctx: OrchestratorContext = {
      taskId: "t-cpp",
      workspaceRoot: "/fake",
      systemPrompt: "sys",
      userPrompt: "give a sample code of C++",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 5000 },
      onEvent: e => events.push(e)
    };

    const res = await orchestrator.run(ctx);
    expect(res.status).toBe("completed");
    expect(res.plan?.steps).toHaveLength(1);
    expect(res.finalText).toBe("Here is C++ sample code:\n```cpp\nint main() { return 0; }\n```");

    const completedEvt = events.find(e => e.type === "task.completed");
    expect(completedEvt).toBeDefined();
    expect(completedEvt.finalText).toBe("Here is C++ sample code:\n```cpp\nint main() { return 0; }\n```");
  });
});
