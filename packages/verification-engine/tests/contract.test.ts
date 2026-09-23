import { describe, it, expect } from "vitest";
import { ToolExecutor, ToolRegistry } from "@comu/tool-core";
import { VerificationPolicy } from "../src/verification_policy.js";
import { ResultAggregator } from "../src/result_aggregator.js";
import { VerificationEngine } from "../src/verification_engine.js";

/**
 * What to verify comes from the task contract, never from the wording of the prompt.
 *
 * The policy used to skip verification when the prompt started with "explain" or "what", and to
 * require tests when the prompt contained "test". A read-only onboarding task that opened "You have
 * just been handed this repository" was therefore typechecked, tested and built against a repository
 * it had not touched, and failed. The kernel already sets expectedMutation and verificationRequired
 * on the contract; nothing read them. Decision 0017, fifth instance.
 */

const READ_ONLY = { expectedMutation: false, verificationRequired: false };
const MUTATING = { expectedMutation: true, verificationRequired: true };

const policy = new VerificationPolicy();

describe("requiredness from the contract", () => {
  it("verifies nothing for a read-only task, whatever its prompt or files say", () => {
    const plan = policy.determinePlan([], READ_ONLY);
    expect(plan.rules.every(r => !r.required && r.skipReason)).toBe(true);
    // Even when the words that used to trigger checks are nowhere near a question.
    const withFiles = policy.determinePlan(["src/main.ts", "package.json"], READ_ONLY);
    expect(withFiles.rules.every(r => !r.required)).toBe(true);
  });

  it("requires the test suite for any task expected to change code", () => {
    // No TypeScript, no test file, no "test" in any prompt: the t2-py-validator shape.
    const plan = policy.determinePlan(["orders/validation.py"], MUTATING);
    expect(plan.rules.find(r => r.validatorId === "run_tests")?.required).toBe(true);
  });

  it("takes no prompt at all, so prose cannot decide it", () => {
    expect(policy.determinePlan.length).toBe(2);
  });
});

describe("nothing checked is not the same as checks passed", () => {
  it("reports NOT_VERIFIED, never PASSED, when no required check exists", () => {
    const result = ResultAggregator.aggregate(
      "t",
      [{ id: "c", name: "Test Suite", required: false, status: "SKIPPED", validatorId: "run_tests", skipReason: "read-only" }],
      5
    );
    expect(result.status).toBe("NOT_VERIFIED");
    expect(result.notVerifiedReason).toBeTruthy();
  });

  it("reports NOT_VERIFIED for an empty check list", () => {
    expect(ResultAggregator.aggregate("t", [], 1).status).toBe("NOT_VERIFIED");
  });
});

function engineWith(tools: Record<string, () => Promise<any>>) {
  const registry = new ToolRegistry();
  for (const [name, execute] of Object.entries(tools)) {
    registry.register({ name, description: name, capabilities: ["execute"], inputSchema: {}, execute });
  }
  const executor = new ToolExecutor(registry);
  const toolContext: any = {
    taskId: "t",
    workspace: { rootPath: "/fake" },
    limits: { maxResults: 10, maxBytes: 1000 },
    permissions: { capabilities: { read: "ALLOW", write: "DENY", execute: "ALLOW", network: "DENY" } },
    abortSignal: new AbortController().signal
  };
  return { engine: new VerificationEngine(), executor, toolContext };
}

describe("a check that could not run stays distinguishable from one that failed", () => {
  it("keeps a validator's UNAVAILABLE as UNAVAILABLE, with a reason, all the way to the result", async () => {
    // What run_tests returns when no test command resolves for the project.
    const { engine, executor, toolContext } = engineWith({
      run_tests: async () => ({ validatorId: "run_tests", name: "test", status: "UNAVAILABLE", exitCode: null, stdout: "", stderr: "" }),
      run_typecheck: async () => ({ status: "PASS", exitCode: 0 })
    });
    const result = await engine.runVerification({
      taskId: "t",
      workspaceRoot: "/fake",
      changedFiles: ["orders/validation.py"],
      requirement: MUTATING,
      toolExecutor: executor,
      toolContext
    });
    const tests = result.checks.find(c => c.validatorId === "run_tests")!;
    expect(tests.status).toBe("UNAVAILABLE");
    expect(tests.details).toMatch(/could not run|no .*command/i);
    expect(result.status).toBe("UNAVAILABLE");
  });
});

describe("a suite that already passed is not evidence of the change", () => {
  const passingSuite = () =>
    engineWith({
      run_tests: async () => ({ status: "PASS", exitCode: 0, stdout: "9 passed" }),
      run_typecheck: async () => ({ status: "PASS", exitCode: 0 })
    });

  it("reports NOT_VERIFIED when every required check passed before the change too and no test was touched", async () => {
    const { engine, executor, toolContext } = passingSuite();
    const run = (changedFiles: string[], baseline?: any) =>
      engine.runVerification({ taskId: "t", workspaceRoot: "/fake", changedFiles, requirement: MUTATING, toolExecutor: executor, toolContext, baseline });

    // The t2-py-validator case: the prompt itself says the existing suite passes today.
    const baseline = await run([]);
    expect(baseline.status).toBe("PASSED");
    const after = await run(["orders/validation.py"], baseline);
    expect(after.status).toBe("NOT_VERIFIED");
    expect(after.notVerifiedReason).toMatch(/passed before/i);
  });

  it("still reports PASSED when the agent added or changed a test, since the suite now exercises the change", async () => {
    const { engine, executor, toolContext } = passingSuite();
    const run = (changedFiles: string[], baseline?: any) =>
      engine.runVerification({ taskId: "t", workspaceRoot: "/fake", changedFiles, requirement: MUTATING, toolExecutor: executor, toolContext, baseline });
    const baseline = await run([]);
    const after = await run(["orders/validation.py", "orders/test_validate_order.py"], baseline);
    expect(after.status).toBe("PASSED");
  });

  it("still reports PASSED when a required check failed before the change and passes after it", async () => {
    let fixed = false;
    const { engine, executor, toolContext } = engineWith({
      run_tests: async () => (fixed ? { status: "PASS", exitCode: 0 } : { status: "FAIL", exitCode: 1, stderr: "1 failed" }),
      run_typecheck: async () => ({ status: "PASS", exitCode: 0 })
    });
    const run = (changedFiles: string[], baseline?: any) =>
      engine.runVerification({ taskId: "t", workspaceRoot: "/fake", changedFiles, requirement: MUTATING, toolExecutor: executor, toolContext, baseline });
    const baseline = await run([]);
    fixed = true;
    expect((await run(["billing/periods.py"], baseline)).status).toBe("PASSED");
  });
});
