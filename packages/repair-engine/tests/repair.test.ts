import { describe, it, expect } from "vitest";
import { RepairEngine } from "../src/repair_engine.js";
import { FailureDiagnosis } from "@comu/protocol";

describe("Repair Engine", () => {
  const diagnosis: FailureDiagnosis = {
    diagnosisId: "diag-1",
    taskId: "task-1",
    failureType: "TEST_FAILURE",
    summary: "Auth middleware test failed",
    affectedFiles: ["src/auth.ts", "tests/auth.test.ts"],
    evidence: { exitCode: 1 },
    confidence: 0.9,
    failureFingerprint: "fp-auth-failure",
    suggestedActions: [],
    timestamp: new Date().toISOString()
  };

  it("should allow a normal first repair within limits", () => {
    const engine = new RepairEngine();
    const decision = engine.evaluateRepair({
      taskId: "task-1",
      diagnosis,
      proposedTargetFiles: ["src/auth.ts"],
      proposedStrategyDescription: "Fix token verification logic",
      existingChangedFiles: [],
      startTimeMs: Date.now(),
      totalValidationRuns: 1
    });

    expect(decision.eligible).toBe(true);
    expect(decision.failureFingerprint).toBe("fp-auth-failure");
  });

  it("should block duplicate repair attempts with identical failure and strategy", () => {
    const engine = new RepairEngine();

    const decision1 = engine.evaluateRepair({
      taskId: "task-1",
      diagnosis,
      proposedTargetFiles: ["src/auth.ts"],
      proposedStrategyDescription: "Fix token verification logic",
      existingChangedFiles: [],
      startTimeMs: Date.now(),
      totalValidationRuns: 1
    });

    // Record the first attempt
    engine.recordAttempt({
      attemptId: "att-1",
      taskId: "task-1",
      attemptNumber: 1,
      failureFingerprint: decision1.failureFingerprint,
      repairStrategyFingerprint: decision1.repairStrategyFingerprint!,
      repairAttemptFingerprint: "attempt-fp-1",
      targetFiles: ["src/auth.ts"],
      changeSummary: "Edited auth.ts",
      validationStatus: "FAILED",
      createdAt: new Date().toISOString()
    });

    // Try identical strategy again
    const decision2 = engine.evaluateRepair({
      taskId: "task-1",
      diagnosis,
      proposedTargetFiles: ["src/auth.ts"],
      proposedStrategyDescription: "Fix token verification logic",
      existingChangedFiles: [],
      startTimeMs: Date.now(),
      totalValidationRuns: 2
    });

    expect(decision2.eligible).toBe(false);
    expect(decision2.reason).toContain("DUPLICATE_REPAIR_STRATEGY");
  });

  it("should allow a distinct second repair strategy on the same failure", () => {
    const engine = new RepairEngine();

    const decision1 = engine.evaluateRepair({
      taskId: "task-1",
      diagnosis,
      proposedTargetFiles: ["src/auth.ts"],
      proposedStrategyDescription: "Strategy A: update regex",
      existingChangedFiles: [],
      startTimeMs: Date.now(),
      totalValidationRuns: 1
    });

    engine.recordAttempt({
      attemptId: "att-1",
      taskId: "task-1",
      attemptNumber: 1,
      failureFingerprint: decision1.failureFingerprint,
      repairStrategyFingerprint: decision1.repairStrategyFingerprint!,
      repairAttemptFingerprint: "att-fp-1",
      targetFiles: ["src/auth.ts"],
      changeSummary: "Edited regex",
      validationStatus: "FAILED",
      createdAt: new Date().toISOString()
    });

    // Distinct strategy B
    const decision2 = engine.evaluateRepair({
      taskId: "task-1",
      diagnosis,
      proposedTargetFiles: ["src/auth.ts", "tests/auth.test.ts"],
      proposedStrategyDescription: "Strategy B: align status code constants",
      existingChangedFiles: ["src/auth.ts"],
      startTimeMs: Date.now(),
      totalValidationRuns: 2
    });

    expect(decision2.eligible).toBe(true);
    expect(decision2.repairStrategyFingerprint).not.toBe(decision1.repairStrategyFingerprint);
  });

  it("should enforce maxRepairAttempts limit", () => {
    const engine = new RepairEngine({ defaultLimits: { maxRepairAttempts: 2, maxValidationRuns: 6, maxRepairFiles: 5, maxRepairTimeMs: 180000 } });

    for (let i = 0; i < 2; i++) {
      engine.recordAttempt({
        attemptId: `att-${i}`,
        taskId: "task-limit",
        attemptNumber: i + 1,
        failureFingerprint: `fp-${i}`,
        repairStrategyFingerprint: `strat-${i}`,
        repairAttemptFingerprint: `attempt-${i}`,
        targetFiles: ["src/auth.ts"],
        changeSummary: "edit",
        validationStatus: "FAILED",
        createdAt: new Date().toISOString()
      });
    }

    const decision = engine.evaluateRepair({
      taskId: "task-limit",
      diagnosis,
      proposedTargetFiles: ["src/auth.ts"],
      existingChangedFiles: [],
      startTimeMs: Date.now(),
      totalValidationRuns: 2
    });

    expect(decision.eligible).toBe(false);
    expect(decision.reason).toContain("REPAIR_LIMIT_REACHED");
  });

  it("should prevent excessive repair scope expansion", () => {
    const engine = new RepairEngine();
    const decision = engine.evaluateRepair({
      taskId: "task-scope",
      diagnosis,
      proposedTargetFiles: [
        "src/auth.ts",
        "src/database.ts",
        "src/routes.ts",
        "src/utils.ts",
        "src/config.ts",
        "src/extra.ts" // Exceeds default limit of 5 files
      ],
      existingChangedFiles: [],
      startTimeMs: Date.now(),
      totalValidationRuns: 1
    });

    expect(decision.eligible).toBe(false);
    expect(decision.reason).toContain("REPAIR_SCOPE_EXCEEDED");
  });
});
