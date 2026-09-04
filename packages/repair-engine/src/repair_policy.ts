import { RepairLimits, FailureDiagnosis } from "@comu/protocol";

export const DEFAULT_REPAIR_LIMITS: RepairLimits = {
  maxRepairAttempts: 3,
  maxValidationRuns: 6,
  maxRepairFiles: 5,
  maxRepairTimeMs: 180000
};

export class RepairPolicy {
  public static checkLimits(
    attemptCount: number,
    totalValidationRuns: number,
    elapsedTimeMs: number,
    targetFilesCount: number,
    limits: RepairLimits
  ): { allowed: boolean; reason?: string } {
    if (attemptCount >= limits.maxRepairAttempts) {
      return {
        allowed: false,
        reason: `REPAIR_LIMIT_REACHED: Maximum repair attempts (${limits.maxRepairAttempts}) reached.`
      };
    }

    if (totalValidationRuns >= limits.maxValidationRuns) {
      return {
        allowed: false,
        reason: `VALIDATION_LIMIT_REACHED: Maximum validation runs (${limits.maxValidationRuns}) reached.`
      };
    }

    if (elapsedTimeMs >= limits.maxRepairTimeMs) {
      return {
        allowed: false,
        reason: `REPAIR_TIMEOUT: Maximum repair time (${limits.maxRepairTimeMs}ms) exceeded.`
      };
    }

    if (targetFilesCount > limits.maxRepairFiles) {
      return {
        allowed: false,
        reason: `REPAIR_SCOPE_EXCEEDED: Target files count (${targetFilesCount}) exceeds maximum allowed (${limits.maxRepairFiles}).`
      };
    }

    return { allowed: true };
  }

  public static validateScope(
    diagnosis: FailureDiagnosis,
    proposedTargetFiles: string[],
    existingChangedFiles: string[],
    maxRepairFiles: number
  ): { valid: boolean; normalizedTargets: string[]; reason?: string } {
    const allowedSet = new Set<string>([
      ...diagnosis.affectedFiles.map(f => f.replace(/\\/g, "/")),
      ...existingChangedFiles.map(f => f.replace(/\\/g, "/"))
    ]);

    const normalizedTargets = proposedTargetFiles.map(f => f.replace(/\\/g, "/"));

    if (normalizedTargets.length > maxRepairFiles) {
      return {
        valid: false,
        normalizedTargets,
        reason: `REPAIR_SCOPE_EXCEEDED: Proposed ${normalizedTargets.length} files exceeds limit of ${maxRepairFiles}.`
      };
    }

    // Check for excessive unrelated files (more than 2 completely new unrelated files)
    const unrelatedFiles = normalizedTargets.filter(f => !allowedSet.has(f));
    if (unrelatedFiles.length > 2) {
      return {
        valid: false,
        normalizedTargets,
        reason: `REPAIR_SCOPE_EXCEEDED: Modifying ${unrelatedFiles.length} unrelated files (${unrelatedFiles.join(", ")}) outside failure scope.`
      };
    }

    return {
      valid: true,
      normalizedTargets
    };
  }
}
