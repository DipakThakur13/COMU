import { describe, it, expect } from "vitest";
import { AgentOrchestrator, OrchestratorContext, InteractionManager } from "@comu/agent-core";
import { TaskPlanner } from "@comu/planning-engine";
import { VerificationEngine } from "@comu/verification-engine";
import { RepairEngine } from "@comu/repair-engine";
import { ToolExecutor, ToolRegistry } from "@comu/tool-core";
import { ComuDiffEngine } from "@comu/diff-engine";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";

class TestScriptableModel implements ModelProvider {
  id = "test-model";
  name = "Test Model";
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
    if (!res) {
      return { text: "Default completion" };
    }
    return res;
  }
}

describe("Milestone 6: Autonomous Engineering Orchestration E2E Scenarios", () => {
  // Scenario 1: Canonical Fix Loop
  it("Scenario 1: Canonical Test-Fix-Verify Flow", async () => {
    const model = new TestScriptableModel();
    let testRuns = 0;

    const registry = new ToolRegistry();
    // File tools
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
      execute: async () => ({ content: "const auth = false;", hash: "hash-0" })
    });

    // Test runner tool: fails first time, passes second time
    registry.register({
      name: "run_tests",
      description: "tests",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => {
        testRuns++;
        if (testRuns === 1) {
          return {
            status: "FAIL",
            exitCode: 1,
            stdout: "FAIL tests/auth.test.ts\nAssertionError: expected 401 to be 200",
            durationMs: 50
          };
        }
        return {
          status: "PASS",
          exitCode: 0,
          stdout: "PASS tests/auth.test.ts\nAll tests passed",
          durationMs: 40
        };
      }
    });

    // Typecheck passes
    registry.register({
      name: "run_typecheck",
      description: "typecheck",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({ status: "PASS", exitCode: 0, stdout: "0 errors" })
    });

    // Model responses for each step:
    // 1. Inspect response
    // 2. Repair tool call response
    // 3. Post-repair response
    model.responses = [
      { text: "Inspecting test failure in tests/auth.test.ts" },
      {
        text: "Fixing auth logic",
        toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "src/auth.ts", content: "const auth = true;" } }]
      },
      { text: "Repaired auth middleware" }
    ];

    const executor = new ToolExecutor(registry);
    const diffEngine = new ComuDiffEngine();
    const planner = new TaskPlanner();
    const verificationEngine = new VerificationEngine();
    const repairEngine = new RepairEngine();

    const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine, {
      planner,
      verificationEngine,
      repairEngine
    });

    const events: any[] = [];
    const ctx: OrchestratorContext = {
      taskId: "e2e-scen-1",
      workspaceRoot: "/workspace",
      systemPrompt: "sys",
      userPrompt: "Fix the failing tests in tests/auth.test.ts",
      limits: { maxSteps: 20, maxToolCalls: 20, maxExecutionTimeMs: 10000 },
      onEvent: e => events.push(e)
    };

    const result = await orchestrator.run(ctx);

    expect(result.status).toBe("completed");
    expect(result.verificationResult?.status).toBe("PASSED");
    expect(result.plan?.version).toBeGreaterThan(1);
    expect(events.some(e => e.type === "diagnosis.created")).toBe(true);
    expect(events.some(e => e.type === "plan.updated")).toBe(true);
    expect(events.some(e => e.type === "task.completed")).toBe(true);
  });

  // Scenario 2 & 3: Duplicate Repair Strategy Prevention
  it("Scenario 3: Duplicate Repair Strategy Prevention", async () => {
    const model = new TestScriptableModel();

    const registry = new ToolRegistry();
    // Test runner always fails with exact same error
    registry.register({
      name: "run_tests",
      description: "tests",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({
        status: "FAIL",
        exitCode: 1,
        stdout: "FAIL tests/syntax.test.ts\nSyntaxError: Unexpected token",
        durationMs: 30
      })
    });
    registry.register({
      name: "run_typecheck",
      description: "typecheck",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({ status: "PASS", exitCode: 0, stdout: "ok" })
    });

    const executor = new ToolExecutor(registry);
    const diffEngine = new ComuDiffEngine();
    const repairEngine = new RepairEngine();

    // Manually record an attempt with identical failure and strategy fingerprint
    const fpFailure = "67980e140d34faea";
    const fpStrategy = "6d3c8c7d3a0e4125";
    repairEngine.recordAttempt({
      attemptId: "att-prior",
      taskId: "e2e-dup-rep",
      attemptNumber: 1,
      failureFingerprint: fpFailure,
      repairStrategyFingerprint: fpStrategy,
      repairAttemptFingerprint: "att-fp-prior",
      targetFiles: ["tests/syntax.test.ts"],
      changeSummary: "Edited file with exact same change",
      validationStatus: "FAILED",
      createdAt: new Date().toISOString()
    });

    const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine, {
      repairEngine
    });

    const ctx: OrchestratorContext = {
      taskId: "e2e-dup-rep",
      workspaceRoot: "/workspace",
      systemPrompt: "sys",
      userPrompt: "Fix syntax error in tests/syntax.test.ts",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 5000 },
      onEvent: () => {}
    };

    const res = await orchestrator.run(ctx);

    // Should stop with limit_reached or failed, avoiding infinite loop!
    expect(res.status).not.toBe("completed");
  });

  // Scenario 4: Repair Limit Reached
  it("Scenario 4: Repair Limit Reached", async () => {
    const model = new TestScriptableModel();

    const registry = new ToolRegistry();
    registry.register({
      name: "run_tests",
      description: "tests",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({
        status: "FAIL",
        exitCode: 1,
        stdout: "FAIL tests/fatal.test.ts\nFatalError: Cannot recover",
        durationMs: 10
      })
    });
    registry.register({
      name: "run_typecheck",
      description: "typecheck",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({ status: "PASS", exitCode: 0, stdout: "ok" })
    });

    const repairEngine = new RepairEngine({
      defaultLimits: { maxRepairAttempts: 1, maxValidationRuns: 1, maxRepairFiles: 5, maxRepairTimeMs: 5000 }
    });

    // Record an attempt to immediately exhaust maxRepairAttempts (1)
    repairEngine.recordAttempt({
      attemptId: "att-exhausted",
      taskId: "e2e-limit",
      attemptNumber: 1,
      failureFingerprint: "fp-1",
      repairStrategyFingerprint: "fp-s1",
      repairAttemptFingerprint: "fp-a1",
      targetFiles: ["tests/fatal.test.ts"],
      changeSummary: "attempt 1",
      validationStatus: "FAILED",
      createdAt: new Date().toISOString()
    });

    const orchestrator = new AgentOrchestrator(
      model,
      registry,
      new ToolExecutor(registry),
      new ComuDiffEngine(),
      { repairEngine }
    );

    const ctx: OrchestratorContext = {
      taskId: "e2e-limit",
      workspaceRoot: "/workspace",
      systemPrompt: "sys",
      userPrompt: "Fix fatal error in tests/fatal.test.ts",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 5000, maxRepairAttempts: 1 },
      onEvent: () => {}
    };

    const res = await orchestrator.run(ctx);
    expect(res.status).toBe("failed");
    expect(res.error).toContain("REPAIR_LIMIT_REACHED");
  });

  // Scenario 5: Required Verification Unavailable Blocks Completion
  it("Scenario 5: Required Verification Unavailable Blocks Completion", async () => {
    const model = new TestScriptableModel();
    model.responses = [{ text: "Done without tests" }];

    const registry = new ToolRegistry();
    // No test tool registered!
    const orchestrator = new AgentOrchestrator(
      model,
      registry,
      new ToolExecutor(registry),
      new ComuDiffEngine()
    );

    const ctx: OrchestratorContext = {
      taskId: "e2e-unavail",
      workspaceRoot: "/workspace",
      systemPrompt: "sys",
      userPrompt: "Fix the failing tests in src/index.ts",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 5000 },
      onEvent: () => {}
    };

    const res = await orchestrator.run(ctx);
    expect(res.status).toBe("failed");
    expect(res.verificationResult?.status).toBe("UNAVAILABLE");
  });

  // Scenario 6: Optional Verification Skipped for Documentation
  it("Scenario 6: Optional Verification Skipped for Documentation", async () => {
    const model = new TestScriptableModel();
    model.responses = [{ text: "README updated" }];

    const registry = new ToolRegistry();
    const orchestrator = new AgentOrchestrator(
      model,
      registry,
      new ToolExecutor(registry),
      new ComuDiffEngine()
    );

    const ctx: OrchestratorContext = {
      taskId: "e2e-docs",
      workspaceRoot: "/workspace",
      systemPrompt: "sys",
      userPrompt: "Update documentation in README.md",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 5000 },
      onEvent: () => {}
    };

    const res = await orchestrator.run(ctx);
    expect(res.status).toBe("completed");
    expect(res.verificationResult?.checks.every(c => c.status === "SKIPPED")).toBe(true);
  });

  // Scenario 7: Workspace Integrity Failure
  it("Scenario 7: External Workspace Mutation Blocks Completion", async () => {
    const model = new TestScriptableModel();
    model.responses = [
      {
        text: "Editing file",
        toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "src/data.ts", content: "export const data = 1;" } }]
      },
      { text: "Finished edit" }
    ];

    let readCallCount = 0;
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
      execute: async () => {
        readCallCount++;
        // During integrity check at completion, return a corrupted/mismatched hash!
        if (readCallCount > 2) {
          return { content: "externally modified!", hash: "corrupted-hash" };
        }
        return { content: "export const data = 1;", hash: "hash-initial" };
      }
    });
    registry.register({
      name: "run_typecheck",
      description: "tc",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({ status: "PASS", exitCode: 0 })
    });
    registry.register({
      name: "run_tests",
      description: "test",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({ status: "PASS", exitCode: 0 })
    });

    const orchestrator = new AgentOrchestrator(
      model,
      registry,
      new ToolExecutor(registry),
      new ComuDiffEngine()
    );

    const ctx: OrchestratorContext = {
      taskId: "e2e-integ-fail",
      workspaceRoot: "/workspace",
      systemPrompt: "sys",
      userPrompt: "Update src/data.ts",
      limits: { maxSteps: 20, maxToolCalls: 20, maxExecutionTimeMs: 5000 },
      onEvent: () => {}
    };

    const res = await orchestrator.run(ctx);
    expect(res.status).toBe("failed");
    expect(res.workspaceIntegrity?.status).toBe("CHANGED_EXTERNALLY");
  });

  // Scenario 8: Human Interaction (INPUT)
  it("Scenario 8: Human Input Interaction Pauses and Resumes", async () => {
    const interactionManager = new InteractionManager(2000);
    const events: any[] = [];

    const promise = interactionManager.requestInput(
      "task-input",
      "Database Selection",
      "Which database should we configure?",
      ["PostgreSQL", "SQLite", "MongoDB"],
      2000,
      e => events.push(e)
    );

    const pending = interactionManager.getPendingInteraction("task-input");
    expect(pending).toBeDefined();
    expect(pending?.type).toBe("INPUT");

    // Resolve with choice
    const success = interactionManager.resolveInteraction(
      "task-input",
      pending!.interactionId,
      { type: "INPUT", value: "PostgreSQL" },
      e => events.push(e)
    );

    expect(success).toBe(true);
    const chosenDb = await promise;
    expect(chosenDb).toBe("PostgreSQL");
    expect(events.some(e => e.type === "interaction.responded")).toBe(true);
  });

  // Scenario 9: Human Interaction (APPROVAL)
  it("Scenario 9: Human Approval Granted and Denied", async () => {
    const interactionManager = new InteractionManager(2000);

    // 1. Approval granted
    const grantPromise = interactionManager.requestApproval(
      "task-appr-1",
      "Run Migration",
      "Allow running database migrations?",
      2000
    );
    const pending1 = interactionManager.getPendingInteraction("task-appr-1");
    expect(pending1).toBeDefined();

    interactionManager.resolveInteraction("task-appr-1", pending1!.interactionId, { type: "APPROVE" });
    const granted = await grantPromise;
    expect(granted).toBe(true);

    // 2. Approval denied
    const denyPromise = interactionManager.requestApproval(
      "task-appr-2",
      "Drop Table",
      "Allow dropping user tables?",
      2000
    );
    const pending2 = interactionManager.getPendingInteraction("task-appr-2");
    interactionManager.resolveInteraction("task-appr-2", pending2!.interactionId, { type: "DENY" });
    const denied = await denyPromise;
    expect(denied).toBe(false);
  });

  // Scenario 10: Approval Expiration
  it("Scenario 10: Approval Expiration is Treated as Denied", async () => {
    const interactionManager = new InteractionManager(50);
    const expiredPromise = interactionManager.requestApproval(
      "task-exp",
      "Elevated Access",
      "Permission required",
      50 // 50ms timeout
    );

    const res = await expiredPromise;
    // Must resolve false, NEVER implicit approval
    expect(res).toBe(false);
  });

  // Scenario 11: Cancellation Propagation
  it("Scenario 11: Cancellation Propagates and Halts Execution", async () => {
    const model = new TestScriptableModel();
    const registry = new ToolRegistry();
    const controller = new AbortController();

    const orchestrator = new AgentOrchestrator(
      model,
      registry,
      new ToolExecutor(registry),
      new ComuDiffEngine()
    );

    // Abort immediately
    controller.abort();

    const ctx: OrchestratorContext = {
      taskId: "e2e-cancel",
      workspaceRoot: "/workspace",
      systemPrompt: "sys",
      userPrompt: "Do long running work",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 5000 },
      onEvent: () => {},
      abortSignal: controller.signal
    };

    const res = await orchestrator.run(ctx);
    expect(res.status).toBe("cancelled");
  });
});
