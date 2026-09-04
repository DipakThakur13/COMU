import { RepairDecision, RepairAttempt } from "@comu/protocol";
import { FingerprintGenerator } from "@comu/diagnostics-engine";
import { RepairEvaluationContext, RepairEngineOptions } from "./interfaces.js";
import { AttemptTracker } from "./attempt_tracker.js";
import { RepairPolicy, DEFAULT_REPAIR_LIMITS } from "./repair_policy.js";

export class RepairEngine {
  private tracker: AttemptTracker;
  private defaultLimits = DEFAULT_REPAIR_LIMITS;

  constructor(options?: RepairEngineOptions) {
    this.tracker = new AttemptTracker();
    if (options?.defaultLimits) {
      this.defaultLimits = { ...this.defaultLimits, ...options.defaultLimits };
    }
  }

  public evaluateRepair(ctx: RepairEvaluationContext): RepairDecision {
    const limits = { ...this.defaultLimits, ...ctx.limits };
    const currentAttempts = this.tracker.getAttemptCount(ctx.taskId);
    const elapsedTimeMs = Date.now() - ctx.startTimeMs;

    const failureFingerprint = ctx.diagnosis.failureFingerprint;
    const strategyDescription = ctx.proposedStrategyDescription || `Fix ${ctx.diagnosis.failureType} in ${ctx.proposedTargetFiles.join(",")}`;

    const repairStrategyFingerprint = FingerprintGenerator.createRepairStrategyFingerprint(
      ctx.diagnosis.failureType,
      ctx.proposedTargetFiles,
      strategyDescription
    );

    // 1. Check budget limits
    const limitCheck = RepairPolicy.checkLimits(
      currentAttempts,
      ctx.totalValidationRuns,
      elapsedTimeMs,
      ctx.proposedTargetFiles.length,
      limits
    );

    if (!limitCheck.allowed) {
      return {
        eligible: false,
        reason: limitCheck.reason || "Repair limits exceeded",
        failureFingerprint,
        repairStrategyFingerprint,
        targetFiles: ctx.proposedTargetFiles
      };
    }

    // 2. Check duplicate repair attempt
    const isDuplicate = this.tracker.hasIdenticalStrategy(
      ctx.taskId,
      failureFingerprint,
      repairStrategyFingerprint
    );

    if (isDuplicate) {
      return {
        eligible: false,
        reason: "DUPLICATE_REPAIR_STRATEGY: An identical repair strategy has already failed for this failure signature. Choose another strategy or ask user.",
        failureFingerprint,
        repairStrategyFingerprint,
        targetFiles: ctx.proposedTargetFiles
      };
    }

    // 3. Validate repair scope
    const scopeCheck = RepairPolicy.validateScope(
      ctx.diagnosis,
      ctx.proposedTargetFiles,
      ctx.existingChangedFiles,
      limits.maxRepairFiles
    );

    if (!scopeCheck.valid) {
      return {
        eligible: false,
        reason: scopeCheck.reason || "REPAIR_SCOPE_EXCEEDED",
        failureFingerprint,
        repairStrategyFingerprint,
        targetFiles: scopeCheck.normalizedTargets
      };
    }

    return {
      eligible: true,
      reason: "Repair eligible within bounds",
      failureFingerprint,
      repairStrategyFingerprint,
      targetFiles: scopeCheck.normalizedTargets,
      constraints: [
        `Attempt ${currentAttempts + 1} of ${limits.maxRepairAttempts}`,
        `Max target files: ${limits.maxRepairFiles}`,
        `Preserve existing ChangeSet and OCC integrity`
      ]
    };
  }

  public recordAttempt(attempt: RepairAttempt): void {
    this.tracker.recordAttempt(attempt);
  }

  public getAttempts(taskId: string): RepairAttempt[] {
    return this.tracker.getAttempts(taskId);
  }

  public getAttemptCount(taskId: string): number {
    return this.tracker.getAttemptCount(taskId);
  }

  public clear(taskId: string): void {
    this.tracker.clear(taskId);
  }
}
