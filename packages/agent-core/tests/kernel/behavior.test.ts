import { describe, it, expect, vi, beforeEach } from "vitest";
import { IntentRouter } from "../../src/interaction/intent_router.js";
import { ClarificationHandler } from "../../src/interaction/clarification_handler.js";
import { validateTaskContract, TaskContract } from "../../src/interaction/task_contract.js";

describe("Agent Kernel & Interaction Boundary (Batch 1)", () => {
  describe("IntentRouter", () => {
    let router: IntentRouter;

    beforeEach(() => {
      router = new IntentRouter();
    });

    // TEST 01 & 02: "Hi" / "Hello" -> CHAT
    it("should classify 'Hi' as CHAT", () => {
      const result = router.route("Hi");
      expect(result.mode).toBe("CHAT");
      expect(result.requiresClarification).toBe(false);
    });

    it("should classify 'Hello, how are you?' as CHAT", () => {
      const result = router.route("Hello, how are you?");
      expect(result.mode).toBe("CHAT");
      expect(result.requiresClarification).toBe(false);
    });

    // TEST 03 & 04: "Explain auth.ts" -> ASK
    it("should classify 'Explain auth.ts' as ASK", () => {
      const result = router.route("Explain auth.ts");
      expect(result.mode).toBe("ASK");
      expect(result.requiresClarification).toBe(false);
    });

    it("should classify 'How does authentication work in this repository?' as ASK", () => {
      const result = router.route("How does authentication work in this repository?");
      expect(result.mode).toBe("ASK");
    });

    // TEST 05: "Give me a plan to refactor authentication" -> PLAN
    it("should classify 'Give me a plan to refactor authentication' as PLAN", () => {
      const result = router.route("Give me a plan to refactor authentication");
      expect(result.mode).toBe("PLAN");
    });

    // TEST 06: "Fix the failing authentication tests" -> AGENT
    it("should classify 'Fix the failing authentication tests' as AGENT", () => {
      const result = router.route("Fix the failing authentication tests");
      expect(result.mode).toBe("AGENT");
    });

    // TEST 07: "Take a look at this" -> AMBIGUOUS
    it("should classify 'Take a look at this' as AMBIGUOUS without context", () => {
      const result = router.route("Take a look at this");
      expect(result.mode).toBe("AMBIGUOUS");
      expect(result.requiresClarification).toBe(true);
    });

    it("should use context for follow-up additive requests", () => {
      const result = router.route("also update the documentation", { previousMode: "AGENT" });
      expect(result.mode).toBe("AGENT");
    });

    it("should use context to downgrade to ASK for questions", () => {
      const result = router.route("why did that test fail?", { previousMode: "AGENT" });
      expect(result.mode).toBe("ASK");
    });
  });

  describe("TaskContract", () => {
    // TEST 08 & 09 & 10: Contract enforcement
    const createDummyContract = (mode: any, allowedCapabilities: any): TaskContract => ({
      taskId: "test", runId: "test", mode, goal: "test",
      expectedMutation: false,
      allowedCapabilities,
      workspaceScope: {}, allowedTools: [], verificationRequired: false,
      limits: { maxSteps: 10, maxToolCalls: 10, maxExecutionTimeMs: 1000 },
      createdAt: new Date().toISOString(),
      source: "user"
    });

    it("should reject ASK contract + write capabilities", () => {
      const contract = createDummyContract("ASK", ["read"]);
      const res = validateTaskContract(contract, "edit_file", ["write"]);
      expect(res.valid).toBe(false);
    });

    it("should reject PLAN contract + write capabilities", () => {
      const contract = createDummyContract("PLAN", ["read"]);
      const res = validateTaskContract(contract, "write_file", ["write"]);
      expect(res.valid).toBe(false);
    });

    it("should reject CHAT contract + any tool", () => {
      const contract = createDummyContract("CHAT", []);
      const res = validateTaskContract(contract, "run_command", ["execute"]);
      expect(res.valid).toBe(false);
    });

    it("should allow AGENT contract + allowed write tool", () => {
      const contract = createDummyContract("AGENT", ["read", "write", "execute"]);
      const res = validateTaskContract(contract, "write_file", ["write"]);
      expect(res.valid).toBe(true);
    });
  });

  describe("ClarificationHandler", () => {
    it("should generate a clarification message", () => {
      const handler = new ClarificationHandler();
      const req = handler.generateClarificationRequest("Take a look at this");
      expect(req).toContain("What would you like me to do");
    });
  });
});
