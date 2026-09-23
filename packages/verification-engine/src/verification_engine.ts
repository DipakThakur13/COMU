import { VerificationCheck, VerificationResult } from "@comu/protocol";
import { VerificationRunContext } from "./interfaces.js";
import { VerificationPolicy, isTestFile } from "./verification_policy.js";
import { ResultAggregator } from "./result_aggregator.js";

export class VerificationEngine {
  private policy: VerificationPolicy;

  constructor(policy?: VerificationPolicy) {
    this.policy = policy || new VerificationPolicy();
  }

  public async runVerification(ctx: VerificationRunContext): Promise<VerificationResult> {
    const startTime = Date.now();
    const plan = this.policy.determinePlan(ctx.changedFiles, ctx.requirement);
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

        /*
         * The validator could not find a command to run for this project. That is not a failed
         * check: nothing ran. It used to arrive here with exitCode null, become 1, and be recorded
         * as FAILED with empty output, so "could not run" was indistinguishable from "failed" one
         * layer before the completion gate ever saw it.
         */
        if (result?.status === "UNAVAILABLE") {
          checks.push({
            id: `check-${rule.validatorId}`,
            name: rule.name,
            required: rule.required,
            status: "UNAVAILABLE",
            severity: rule.required ? "CRITICAL" : "WARNING",
            validatorId: rule.validatorId,
            startTime: checkStart,
            completionTime: new Date().toISOString(),
            details: `Could not run: no ${rule.name.toLowerCase()} command is configured for this project.`
          });
          continue;
        }

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
    const result = ResultAggregator.aggregate(ctx.taskId, checks, durationMs);
    return ctx.baseline ? assessEvidence(result, ctx.baseline, ctx.changedFiles) : result;
  }
}

/**
 * Whether a passing result is evidence of the change, judged against the same checks before it.
 *
 * t2-py-validator reported PASSED on a suite its own task description said already passed, while a
 * required behaviour was missing. A check that passed before the change and passes after it shows
 * the change broke nothing; it does not show the change does what was asked. It becomes evidence
 * when it was not passing before (the change fixed something), or when the task added or changed a
 * test (the suite now exercises the change).
 */
function assessEvidence(result: VerificationResult, baseline: VerificationResult, changedFiles: string[]): VerificationResult {
  if (result.status !== "PASSED") return result;
  if (changedFiles.some(isTestFile)) return result;

  const before = new Map(baseline.checks.map(c => [c.validatorId, c.status]));
  const evidence = result.checks.some(c => c.required && c.status === "PASSED" && before.get(c.validatorId) !== "PASSED");
  if (evidence) return result;

  const notVerifiedReason =
    "Every required check passed before the change as well, and no test was added or changed, so they show nothing broke but not that the change does what was asked.";
  return { ...result, status: "NOT_VERIFIED", notVerifiedReason, summary: `Verification NOT_VERIFIED: ${notVerifiedReason}` };
}
