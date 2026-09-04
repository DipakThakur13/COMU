import { describe, it, expect } from "vitest";
import { VerificationPolicy } from "../src/verification_policy.js";
import { ResultAggregator } from "../src/result_aggregator.js";
import { VerificationCheck } from "@comu/protocol";

describe("Verification Engine", () => {
  const policy = new VerificationPolicy();

  it("should skip build and tests for documentation-only changes", () => {
    const plan = policy.determinePlan(["README.md", "docs/API.md"]);
    const typecheckRule = plan.rules.find(r => r.validatorId === "run_typecheck");
    const testRule = plan.rules.find(r => r.validatorId === "run_tests");

    expect(typecheckRule?.required).toBe(false);
    expect(typecheckRule?.skipReason).toBeDefined();
    expect(testRule?.required).toBe(false);
    expect(testRule?.skipReason).toBeDefined();
  });

  it("should require typecheck and tests for TypeScript source modifications", () => {
    const plan = policy.determinePlan(["src/auth/middleware.ts"]);
    const typecheckRule = plan.rules.find(r => r.validatorId === "run_typecheck");
    const testRule = plan.rules.find(r => r.validatorId === "run_tests");

    expect(typecheckRule?.required).toBe(true);
    expect(testRule?.required).toBe(true);
  });

  it("should require build when package.json is modified", () => {
    const plan = policy.determinePlan(["package.json"]);
    const buildRule = plan.rules.find(r => r.validatorId === "run_build");
    expect(buildRule?.required).toBe(true);
  });

  it("should aggregate all passed required checks as PASSED", () => {
    const checks: VerificationCheck[] = [
      { id: "1", name: "Typecheck", required: true, status: "PASSED" },
      { id: "2", name: "Tests", required: true, status: "PASSED" },
      { id: "3", name: "Linter", required: false, status: "SKIPPED" }
    ];

    const result = ResultAggregator.aggregate("task-1", checks, 120);
    expect(result.status).toBe("PASSED");
    expect(result.summary).toContain("PASSED");
  });

  it("should mark aggregate as FAILED if any required check fails", () => {
    const checks: VerificationCheck[] = [
      { id: "1", name: "Typecheck", required: true, status: "PASSED" },
      { id: "2", name: "Tests", required: true, status: "FAILED" },
      { id: "3", name: "Linter", required: false, status: "PASSED" }
    ];

    const result = ResultAggregator.aggregate("task-2", checks, 200);
    expect(result.status).toBe("FAILED");
  });

  it("should mark aggregate as UNAVAILABLE if any required check is UNAVAILABLE", () => {
    const checks: VerificationCheck[] = [
      { id: "1", name: "Typecheck", required: true, status: "PASSED" },
      { id: "2", name: "Tests", required: true, status: "UNAVAILABLE" }
    ];

    const result = ResultAggregator.aggregate("task-3", checks, 50);
    expect(result.status).toBe("UNAVAILABLE");
  });

  it("should mark aggregate as PARTIAL if optional check fails while required passes", () => {
    const checks: VerificationCheck[] = [
      { id: "1", name: "Typecheck", required: true, status: "PASSED" },
      { id: "2", name: "Tests", required: true, status: "PASSED" },
      { id: "3", name: "Linter", required: false, status: "FAILED" }
    ];

    const result = ResultAggregator.aggregate("task-4", checks, 80);
    expect(result.status).toBe("PARTIAL");
  });
});
