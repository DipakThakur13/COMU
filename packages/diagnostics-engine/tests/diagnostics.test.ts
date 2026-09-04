import { describe, it, expect } from "vitest";
import { Diagnostician } from "../src/diagnostician.js";
import { FingerprintGenerator } from "../src/fingerprint.js";
import { EvidenceExtractor } from "../src/evidence.js";
import { FailureClassifier } from "../src/classifier.js";
import { VerificationCheck } from "@comu/protocol";

describe("Diagnostics Engine", () => {
  it("should extract compiler error details from stderr", () => {
    const stderr = "src/auth.ts(24,10): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.";
    const evidence = EvidenceExtractor.extractEvidence("", stderr, 1);

    expect(evidence.items).toHaveLength(1);
    expect(evidence.items![0].type).toBe("COMPILER_ERROR");
    expect(evidence.items![0].file).toBe("src/auth.ts");
    expect(evidence.items![0].line).toBe(24);
    expect(evidence.items![0].code).toBe("TS2345");
  });

  it("should extract failing test suites from test runner output", () => {
    const stdout = `
      FAIL tests/auth.test.ts
        ● Auth Middleware › should reject invalid tokens
          AssertionError: expected 401 to equal 200
            at Object.<anonymous> (tests/auth.test.ts:42:15)
    `;
    const evidence = EvidenceExtractor.extractEvidence(stdout, "", 1);

    expect(evidence.failingTests).toContain("tests/auth.test.ts");
    expect(evidence.items?.some(i => i.type === "TEST_FAILURE")).toBe(true);
    expect(evidence.items?.some(i => i.type === "ASSERTION_ERROR")).toBe(true);
  });

  it("should classify failure types accurately", () => {
    const tsEvidence = EvidenceExtractor.extractEvidence("", "src/main.ts(1,1): error TS2304: Cannot find name 'x'.", 1);
    const tsClass = FailureClassifier.classify("run_typecheck", tsEvidence);
    expect(tsClass.failureType).toBe("TYPE_ERROR");

    const testEvidence = EvidenceExtractor.extractEvidence("FAIL tests/app.test.ts", "", 1);
    const testClass = FailureClassifier.classify("run_tests", testEvidence);
    expect(testClass.failureType).toBe("TEST_FAILURE");

    const depEvidence = EvidenceExtractor.extractEvidence("", "Error: Cannot find module 'express'", 1);
    const depClass = FailureClassifier.classify("run_build", depEvidence);
    expect(depClass.failureType).toBe("DEPENDENCY_ERROR");
  });

  it("should produce a complete FailureDiagnosis from a failed VerificationCheck", () => {
    const failedCheck: VerificationCheck = {
      id: "check-tests",
      name: "Test Suite",
      required: true,
      status: "FAILED",
      validatorId: "run_tests",
      exitCode: 1,
      evidence: {
        stdout: "FAIL tests/user.test.ts\nAssertionError: expected false to be true",
        stderr: "",
        exitCode: 1
      }
    };

    const diag = Diagnostician.diagnose("task-1", failedCheck);
    expect(diag.failureType).toBe("TEST_FAILURE");
    expect(diag.affectedFiles).toContain("tests/user.test.ts");
    expect(diag.failureFingerprint).toBeDefined();
    expect(diag.suggestedActions.length).toBeGreaterThan(0);
  });

  it("should generate deterministic fingerprints", () => {
    const fp1 = FingerprintGenerator.createFailureFingerprint("TYPE_ERROR", ["src/a.ts", "src/b.ts"], "TS2345: mismatch");
    const fp2 = FingerprintGenerator.createFailureFingerprint("TYPE_ERROR", ["src/b.ts", "src/a.ts"], "TS2345: mismatch");
    const fp3 = FingerprintGenerator.createFailureFingerprint("TYPE_ERROR", ["src/a.ts"], "TS2345: mismatch");

    // Order of files should be normalized, so fp1 === fp2
    expect(fp1).toBe(fp2);
    // Different files => different fingerprint
    expect(fp1).not.toBe(fp3);
  });
});
