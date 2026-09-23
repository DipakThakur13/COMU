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
  it("completes a documentation change without checks, and says it was not verified", async () => {
    // The skip used to come from the word "documentation" in the prompt. It now comes from the
    // change itself: a README edit has nothing a typecheck or a test run can judge. And a completion
    // with nothing checked says so, rather than passing for verified.
    const model = new MockModel();
    model.responses = [
      { text: "", toolCalls: [{ id: "d1", name: "write_file", arguments: { path: "README.md", content: "# Updated" } }] },
      { text: "Updated README.md content" }
    ];

    const registry = new ToolRegistry();
    registry.register({ name: "write_file", description: "write", capabilities: ["write"], inputSchema: {}, execute: async () => ({ status: "ok" }) });
    registry.register({ name: "read_file", description: "read", capabilities: ["read"], inputSchema: {}, execute: async () => ({ content: "# Updated", hash: "h" }) });
    const executor = new ToolExecutor(registry);
    const diffEngine = new ComuDiffEngine();

    const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine);

    const events: any[] = [];
    const ctx: OrchestratorContext = {
      taskId: "t1",
      workspaceRoot: "/fake",
      autonomy: "auto", // unsupervised harness run: no interaction channel is wired
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
    expect(res.verificationResult?.status).toBe("NOT_VERIFIED");
    expect(events.find(e => e.type === "task.completed")?.verification).toBe("NOT_VERIFIED");
  });

  it("should pass completion gate when required validation checks pass", async () => {
    const model = new MockModel();
    model.responses = [
      { text: "", toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "src/calc.ts", content: "export const x = 1;" } }] },
      { text: "Implementation complete" }
    ];

    // The suite fails until the implementation is written, so passing afterwards is evidence of it.
    // (A suite that passed before the change too would be NOT_VERIFIED; see the next test.)
    let implemented = false;
    const registry = new ToolRegistry();
    registry.register({
      name: "write_file",
      description: "write",
      capabilities: ["write"],
      inputSchema: {},
      execute: async () => {
        implemented = true;
        return { status: "ok" };
      }
    });
    registry.register({
      name: "read_file",
      description: "read",
      capabilities: ["read"],
      inputSchema: {},
      execute: async () => ({ content: "export const x = 1;", hash: "hash-1" })
    });
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
      execute: async () =>
        implemented
          ? { status: "PASS", exitCode: 0, stdout: "1 test passed" }
          : { status: "FAIL", exitCode: 1, stderr: "calc is not defined" }
    });

    const executor = new ToolExecutor(registry);
    const diffEngine = new ComuDiffEngine();
    const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine);

    const events: any[] = [];
    const ctx: OrchestratorContext = {
      taskId: "t2",
      workspaceRoot: "/fake",
      autonomy: "auto", // unsupervised harness run: no interaction channel is wired
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
    expect(events.find(e => e.type === "task.completed")?.verification).toBe("PASSED");
  });

  it("completes a change whose required checks already passed before it, but not as verified", async () => {
    // t2-py-validator: the task said the existing suite passes today, the agent added no test, the
    // suite passed again, and COMU reported PASSED while a required behaviour was missing.
    const model = new MockModel();
    model.responses = [
      { text: "", toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "orders/validation.py", content: "def validate_order(p): return []" } }] },
      { text: "Added validate_order." }
    ];
    const registry = new ToolRegistry();
    registry.register({ name: "write_file", description: "write", capabilities: ["write"], inputSchema: {}, execute: async () => ({ status: "ok" }) });
    registry.register({ name: "read_file", description: "read", capabilities: ["read"], inputSchema: {}, execute: async () => ({ content: "", hash: "h" }) });
    registry.register({ name: "run_tests", description: "tests", capabilities: ["execute"], inputSchema: {}, execute: async () => ({ status: "PASS", exitCode: 0, stdout: "9 passed" }) });
    registry.register({ name: "run_typecheck", description: "typecheck", capabilities: ["execute"], inputSchema: {}, execute: async () => ({ status: "PASS", exitCode: 0 }) });
    const executor = new ToolExecutor(registry);
    const orchestrator = new AgentOrchestrator(model, registry, executor, new ComuDiffEngine());

    const events: any[] = [];
    const memories: any[] = [];
    const res = await orchestrator.run({
      taskId: "t2b",
      workspaceRoot: "/fake",
      autonomy: "auto",
      systemPrompt: "sys",
      userPrompt: "Add a validate_order function to orders/validation.py. The existing tests pass today.",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 5000 },
      onEvent: e => (e.type === "memory.recorded" ? memories.push(e) : events.push(e))
    });

    expect(res.status).toBe("completed");
    expect(res.verificationResult?.status).toBe("NOT_VERIFIED");
    expect(res.verificationResult?.notVerifiedReason).toMatch(/passed before/);
    expect(events.find(e => e.type === "task.completed")?.verification).toBe("NOT_VERIFIED");
    // Nothing unverified is remembered as a verified lesson.
    expect(memories.some(m => m.entry?.trustLevel === "TASK_VERIFIED")).toBe(false);
  });

  it("verifies nothing for a read-only task, and never runs a check against a workspace it did not touch", async () => {
    // The T7 onboarding shape: ASK and readonly. Every check it ran used to fail on an untouched repo.
    const model = new MockModel();
    model.responses = [{ text: "The request enters at src/main.ts and is dispatched by a registry." }];
    const ran: string[] = [];
    const registry = new ToolRegistry();
    for (const name of ["run_tests", "run_typecheck", "run_build", "run_linter"]) {
      registry.register({ name, description: name, capabilities: ["execute"], inputSchema: {}, execute: async () => {
        ran.push(name);
        return { status: "FAIL", exitCode: 1, stderr: "TS5097" };
      } });
    }
    const orchestrator = new AgentOrchestrator(model, registry, new ToolExecutor(registry), new ComuDiffEngine());
    const events: any[] = [];
    const res = await orchestrator.run({
      taskId: "t7",
      workspaceRoot: "/fake",
      mode: "ASK",
      autonomy: "readonly",
      systemPrompt: "sys",
      userPrompt: "You have just been handed this repository. Explain how a request flows through it. Do not modify any file.",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 5000 },
      onEvent: e => events.push(e)
    });

    expect(ran).toEqual([]);
    expect(res.status).toBe("completed");
    expect(res.verificationResult?.status).toBe("NOT_VERIFIED");
    expect(events.find(e => e.type === "task.completed")?.verification).toBe("NOT_VERIFIED");
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
      autonomy: "auto", // unsupervised harness run: no interaction channel is wired
      systemPrompt: "sys",
      userPrompt: "Fix the failing tests",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 5000 },
      onEvent: e => events.push(e)
    };
    const events: any[] = [];

    const res = await orchestrator.run(ctx);
    expect(res.status).toBe("failed");
    expect(res.verificationResult?.status).toBe("UNAVAILABLE");
    // "Could not run" reaches the outcome as itself, never as a failed check.
    const failed = events.find(e => e.type === "task.failed");
    expect(failed?.payload?.code).toBe("VERIFICATION_UNAVAILABLE");
    expect(failed?.error).toMatch(/could not run/i);
    expect(failed?.error).not.toMatch(/did not pass/i);
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
      autonomy: "auto", // unsupervised harness run: no interaction channel is wired
      systemPrompt: "sys",
      userPrompt: "give a sample code of C++",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 5000 },
      onEvent: e => events.push(e)
    };

    const res = await orchestrator.run(ctx);
    console.log("RESULT:", res);
    expect(res.status).toBe("completed");
    expect(res.plan?.steps).toHaveLength(1);
    expect(res.finalText).toBe("Here is C++ sample code:\n```cpp\nint main() { return 0; }\n```");

    const completedEvt = events.find(e => e.type === "task.completed");
    expect(completedEvt).toBeDefined();
    expect(completedEvt.finalText).toBe("Here is C++ sample code:\n```cpp\nint main() { return 0; }\n```");
  });
});
