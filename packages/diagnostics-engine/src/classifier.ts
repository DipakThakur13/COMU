import { FailureType, FailureEvidence } from "@comu/protocol";

export class FailureClassifier {
  public static classify(
    validatorId: string,
    evidence: FailureEvidence,
    checkDetails?: string
  ): { failureType: FailureType; confidence: number } {
    const text = `${evidence.stdout || ""} ${evidence.stderr || ""} ${checkDetails || ""}`.toLowerCase();

    // Timeout
    if (text.includes("timed out") || text.includes("timeout") || text.includes("etimeout")) {
      return { failureType: "TIMEOUT", confidence: 0.95 };
    }

    // TypeScript errors
    const hasTsError = evidence.items?.some(i => i.type === "COMPILER_ERROR" || i.code?.startsWith("TS"));
    if (validatorId === "run_typecheck" || hasTsError || text.includes("error ts")) {
      return { failureType: "TYPE_ERROR", confidence: 0.95 };
    }

    // Test failures
    const hasTestError =
      evidence.items?.some(i => i.type === "TEST_FAILURE" || i.type === "ASSERTION_ERROR") ||
      (evidence.failingTests && evidence.failingTests.length > 0);
    if (validatorId === "run_tests" || hasTestError || text.includes("test failed") || text.includes("failing tests")) {
      return { failureType: "TEST_FAILURE", confidence: 0.9 };
    }

    // Dependency errors (check before generic build failure)
    if (text.includes("cannot find module") || text.includes("err_module_not_found") || text.includes("module not found")) {
      return { failureType: "DEPENDENCY_ERROR", confidence: 0.9 };
    }

    // Configuration errors
    if (text.includes("tsconfig.json") || text.includes("package.json") || text.includes("configuration error")) {
      return { failureType: "CONFIGURATION_ERROR", confidence: 0.85 };
    }

    // Linter failures
    if (validatorId === "run_linter" || text.includes("eslint") || text.includes("lint error")) {
      return { failureType: "LINT_FAILURE", confidence: 0.9 };
    }

    // Build failures
    if (validatorId === "run_build" || text.includes("build failed") || text.includes("compilation failed")) {
      return { failureType: "BUILD_FAILURE", confidence: 0.85 };
    }

    // Runtime errors
    if (text.includes("typeerror:") || text.includes("referenceerror:") || text.includes("syntaxerror:")) {
      return { failureType: "RUNTIME_ERROR", confidence: 0.85 };
    }

    // Generic command failure
    if (evidence.exitCode !== undefined && evidence.exitCode !== 0) {
      return { failureType: "COMMAND_FAILURE", confidence: 0.7 };
    }

    return { failureType: "UNKNOWN", confidence: 0.3 };
  }
}
