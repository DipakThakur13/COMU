import { VerificationPolicyRule, VerificationPlan, VerificationRequirement } from "./interfaces.js";

const DOC_FILE = /\.(md|txt|rst)$/i;

/**
 * Whether a path is a test. Covers the conventions the supported ecosystems use: `*.test.*` and
 * `*.spec.*`, files under a `test`/`tests`/`__tests__` directory, and Python's `test_*.py` and
 * `*_test.py`, plus Go's `*_test.go`.
 */
export function isTestFile(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  return (
    /\.(test|spec)\.[^/]+$/.test(p) ||
    /(^|\/)(tests?|__tests__)\//.test(p) ||
    /(^|\/)test_[^/]*\.py$/.test(p) ||
    /_test\.(py|go)$/.test(p)
  );
}

const skipAll = (reason: string): VerificationPolicyRule[] => [
  { name: "Typecheck", validatorId: "run_typecheck", required: false, skipReason: reason },
  { name: "Test Suite", validatorId: "run_tests", required: false, skipReason: reason },
  { name: "Build", validatorId: "run_build", required: false, skipReason: reason },
  { name: "Linter", validatorId: "run_linter", required: false, skipReason: reason }
];

/**
 * Which checks a task's verification runs, and which of them it must pass.
 *
 * Decided by the task contract and the files the task changed, never by the prompt. The prompt is
 * not a parameter: the old policy skipped everything for a prompt that started with "explain" or
 * "what" and required tests for one that contained "test", so a read-only onboarding task that
 * opened "You have just been handed this repository" was typechecked, tested and built against a
 * repository it had not touched, and failed. Decision 0017, fifth instance.
 */
export class VerificationPolicy {
  public determinePlan(changedFiles: string[], requirement: VerificationRequirement): VerificationPlan {
    if (!requirement.verificationRequired) {
      return {
        rules: skipAll("The task contract does not require verification: this task does not change the workspace."),
        reason: "Verification not required by the task contract."
      };
    }

    // A change confined to documentation has nothing a typecheck, a test run or a build can judge.
    if (changedFiles.length > 0 && changedFiles.every(f => DOC_FILE.test(f))) {
      return {
        rules: skipAll("Documentation change only; there is nothing a check can judge."),
        reason: "Documentation-only modification."
      };
    }

    const hasTypeScript = changedFiles.some(f => /\.tsx?$/.test(f) && !isTestFile(f));
    const hasPackageJson = changedFiles.some(f => f.endsWith("package.json") || f.endsWith("pnpm-lock.yaml"));
    const rules: VerificationPolicyRule[] = [];

    // Before anything has changed (a baseline, or a fix task's first look at the failure) the whole
    // project is what there is to check.
    if (hasTypeScript || hasPackageJson || changedFiles.length === 0) {
      rules.push({ name: "Typecheck", validatorId: "run_typecheck", required: true });
    } else {
      rules.push({ name: "Typecheck", validatorId: "run_typecheck", required: false, skipReason: "No TypeScript source files modified." });
    }

    // A task that changes code is judged by the project's tests, whatever its prompt says.
    rules.push({ name: "Test Suite", validatorId: "run_tests", required: true });

    if (hasPackageJson) {
      rules.push({ name: "Build", validatorId: "run_build", required: true });
    } else {
      rules.push({ name: "Build", validatorId: "run_build", required: false, skipReason: "No dependency or package manifest changed." });
    }

    rules.push({ name: "Linter", validatorId: "run_linter", required: false, skipReason: "Optional code quality check." });

    return { rules, reason: "The task contract requires verification of a code change." };
  }
}
