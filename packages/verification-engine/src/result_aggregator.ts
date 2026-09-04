import { VerificationCheck, VerificationResult, VerificationStatus } from "@comu/protocol";

export class ResultAggregator {
  public static aggregate(
    taskId: string,
    checks: VerificationCheck[],
    durationMs: number
  ): VerificationResult {
    const verificationId = `verif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const requiredChecks = checks.filter(c => c.required);
    const optionalChecks = checks.filter(c => !c.required);

    let status: VerificationStatus = "PASSED";
    const failedRequired = requiredChecks.filter(c => c.status === "FAILED");
    const unavailableRequired = requiredChecks.filter(c => c.status === "UNAVAILABLE");
    const cancelledRequired = requiredChecks.filter(c => c.status === "CANCELLED");

    if (failedRequired.length > 0 || cancelledRequired.length > 0) {
      status = "FAILED";
    } else if (unavailableRequired.length > 0) {
      status = "UNAVAILABLE";
    } else {
      // All required checks passed (or were skipped if policy explicitly allowed)
      const allRequiredPassed = requiredChecks.every(c => c.status === "PASSED" || c.status === "SKIPPED");
      if (!allRequiredPassed) {
        status = "FAILED";
      } else {
        const failedOptional = optionalChecks.filter(c => c.status === "FAILED");
        if (failedOptional.length > 0) {
          status = "PARTIAL";
        } else {
          status = "PASSED";
        }
      }
    }

    const passedCount = checks.filter(c => c.status === "PASSED").length;
    const failedCount = checks.filter(c => c.status === "FAILED").length;
    const skippedCount = checks.filter(c => c.status === "SKIPPED").length;
    const unavailableCount = checks.filter(c => c.status === "UNAVAILABLE").length;

    const summaryParts: string[] = [];
    if (passedCount > 0) summaryParts.push(`${passedCount} passed`);
    if (failedCount > 0) summaryParts.push(`${failedCount} failed`);
    if (unavailableCount > 0) summaryParts.push(`${unavailableCount} unavailable`);
    if (skippedCount > 0) summaryParts.push(`${skippedCount} skipped`);

    const summary = `Verification ${status}: ${summaryParts.join(", ")}`;

    return {
      verificationId,
      taskId,
      status,
      checks,
      summary,
      durationMs,
      timestamp: new Date().toISOString()
    };
  }
}
