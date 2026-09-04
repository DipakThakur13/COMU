import { VerificationPolicyRule, VerificationPlan } from "./interfaces.js";

export class VerificationPolicy {
  public determinePlan(changedFiles: string[], prompt?: string): VerificationPlan {
    const rules: VerificationPolicyRule[] = [];
    const promptLower = (prompt || "").toLowerCase();

    // 1. Check if documentation only
    const isOnlyDocs =
      (changedFiles.length > 0 &&
        changedFiles.every(f => f.endsWith(".md") || f.endsWith(".txt") || f.endsWith(".rst"))) ||
      (changedFiles.length === 0 && (promptLower.includes("readme") || promptLower.includes("doc")));

    if (isOnlyDocs) {
      rules.push({
        name: "Typecheck",
        validatorId: "run_typecheck",
        required: false,
        skipReason: "Documentation change only; typecheck not required."
      });
      rules.push({
        name: "Test Suite",
        validatorId: "run_tests",
        required: false,
        skipReason: "Documentation change only; test suite not required."
      });
      rules.push({
        name: "Build",
        validatorId: "run_build",
        required: false,
        skipReason: "Documentation change only; build not required."
      });
      return {
        rules,
        reason: "Documentation-only modification detected."
      };
    }

    // 1b. Check if purely informational / Q&A query with no workspace modifications
    const isInformational =
      changedFiles.length === 0 &&
      (promptLower.startsWith("give") ||
        promptLower.startsWith("show") ||
        promptLower.startsWith("what") ||
        promptLower.startsWith("how") ||
        promptLower.startsWith("why") ||
        promptLower.startsWith("explain") ||
        promptLower.startsWith("tell") ||
        promptLower.startsWith("can you") ||
        promptLower.startsWith("write a sample") ||
        promptLower.startsWith("write sample") ||
        promptLower.includes("sample code") ||
        promptLower.includes("example code"));

    if (isInformational) {
      rules.push({
        name: "Typecheck",
        validatorId: "run_typecheck",
        required: false,
        skipReason: "Informational query; workspace typecheck not required."
      });
      rules.push({
        name: "Test Suite",
        validatorId: "run_tests",
        required: false,
        skipReason: "Informational query; workspace test suite not required."
      });
      rules.push({
        name: "Build",
        validatorId: "run_build",
        required: false,
        skipReason: "Informational query; build not required."
      });
      rules.push({
        name: "Linter",
        validatorId: "run_linter",
        required: false,
        skipReason: "Optional code quality check."
      });
      return {
        rules,
        reason: "Informational query detected."
      };
    }

    // 2. Check for TypeScript code files
    const hasTypeScript =
      changedFiles.some(f => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes(".test.") && !f.includes(".spec."));
    const hasTests =
      changedFiles.some(f => f.includes(".test.") || f.includes(".spec.") || f.includes("/tests/") || f.includes("/test/"));
    const hasPackageJson = changedFiles.some(f => f.endsWith("package.json") || f.endsWith("pnpm-lock.yaml"));

    // If explicit test fix request or tests changed
    const isTestTask = promptLower.includes("test") || promptLower.includes("fail") || promptLower.includes("fix") || hasTests;

    // Typecheck rule
    if (hasTypeScript || hasPackageJson || promptLower.includes("typecheck") || changedFiles.length === 0) {
      rules.push({
        name: "Typecheck",
        validatorId: "run_typecheck",
        required: true
      });
    } else {
      rules.push({
        name: "Typecheck",
        validatorId: "run_typecheck",
        required: false,
        skipReason: "No TypeScript source files modified."
      });
    }

    // Test suite rule
    if (isTestTask || hasTypeScript || hasTests || changedFiles.length === 0) {
      rules.push({
        name: "Test Suite",
        validatorId: "run_tests",
        required: true
      });
    } else {
      rules.push({
        name: "Test Suite",
        validatorId: "run_tests",
        required: false,
        skipReason: "Non-test source modification without behavioral changes."
      });
    }

    // Build rule
    if (hasPackageJson || promptLower.includes("build")) {
      rules.push({
        name: "Build",
        validatorId: "run_build",
        required: true
      });
    } else {
      rules.push({
        name: "Build",
        validatorId: "run_build",
        required: false,
        skipReason: "Standard localized modification does not require full production build."
      });
    }

    // Linter rule
    rules.push({
      name: "Linter",
      validatorId: "run_linter",
      required: false,
      skipReason: "Optional code quality check."
    });

    return {
      rules,
      reason: "Standard deterministic engineering verification policy applied."
    };
  }
}
