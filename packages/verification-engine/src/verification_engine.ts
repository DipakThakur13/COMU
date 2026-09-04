import { VerificationCheck, VerificationResult } from "@comu/protocol";
import { VerificationRunContext } from "./interfaces.js";
import { VerificationPolicy } from "./verification_policy.js";
import { ResultAggregator } from "./result_aggregator.js";

export class VerificationEngine {
  private policy: VerificationPolicy;

  constructor(policy?: VerificationPolicy) {
    this.policy = policy || new VerificationPolicy();
  }

  public async runVerification(ctx: VerificationRunContext): Promise<VerificationResult> {
    const startTime = Date.now();
    const plan = this.policy.determinePlan(ctx.changedFiles, ctx.userPrompt);
    const checks: VerificationCheck[] = [];

    for (const rule of plan.rules) {
      if (ctx.abortSignal?.aborted) {
        checks.push({
          id: `check-${rule.validatorId}`,
          name: rule.name,
          required: rule.required,
          status: "CANCELLED",
          validatorId: rule.validatorId,
          details: "Verification cancelled by user or timeout"
        });
        break;
      }

      // If skipped by policy
      if (rule.skipReason) {
        checks.push({
          id: `check-${rule.validatorId}`,
          name: rule.name,
          required: rule.required,
          status: "SKIPPED",
          validatorId: rule.validatorId,
          skipReason: rule.skipReason
        });
        continue;
      }

      const checkStart = new Date().toISOString();
      try {
        const result = (await ctx.toolExecutor.execute(rule.validatorId, {}, ctx.toolContext)) as any;

        const exitCode = result?.exitCode ?? (result?.status === "PASS" ? 0 : 1);
        const isPass = result?.status === "PASS" || exitCode === 0;

        // Bounded stdout & stderr
        const maxOutputChars = 5000;
        const stdout = typeof result?.stdout === "string" ? result.stdout.slice(0, maxOutputChars) : "";
        const stderr = typeof result?.stderr === "string" ? result.stderr.slice(0, maxOutputChars) : "";

        checks.push({
          id: `check-${rule.validatorId}`,
          name: rule.name,
          required: rule.required,
          status: isPass ? "PASSED" : "FAILED",
          severity: isPass ? undefined : rule.required ? "CRITICAL" : "WARNING",
          validatorId: rule.validatorId,
          command: result?.command,
          cwd: ctx.workspaceRoot,
          exitCode,
          startTime: checkStart,
          completionTime: new Date().toISOString(),
          details: isPass ? "Check passed successfully" : (stderr || stdout || "Validation check failed"),
          evidence: {
            stdout,
            stderr,
            exitCode,
            durationMs: result?.durationMs
          }
        });
      } catch (err: any) {
        const msg = (err.message || "").toLowerCase();
        const isToolNotFound =
          (msg.includes("tool") && msg.includes("not found")) ||
          msg.includes("not registered") ||
          msg.includes("no such tool");

        checks.push({
          id: `check-${rule.validatorId}`,
          name: rule.name,
          required: rule.required,
          status: isToolNotFound ? "UNAVAILABLE" : "FAILED",
          severity: rule.required ? "CRITICAL" : "ERROR",
          validatorId: rule.validatorId,
          startTime: checkStart,
          completionTime: new Date().toISOString(),
          details: err.message,
          evidence: {
            stderr: err.message,
            exitCode: 1
          }
        });
      }
    }

    const durationMs = Date.now() - startTime;
    return ResultAggregator.aggregate(ctx.taskId, checks, durationMs);
  }
}
