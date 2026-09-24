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

    // A question verb opens the message; a mutation verb anywhere in it makes it a change request.
    // Routed to ASK, "find and fix" verified nothing, changed nothing and reported completion.
    it("routes a question that also asks for a change to AGENT, and a pure question to ASK", () => {
      expect(router.route("find out why the build fails").mode).toBe("ASK");
      expect(router.route("find and fix the null check").mode).toBe("AGENT");
      expect(
        router.route("Find the bug causing the failing test in the user-profile service. Fix the bug, run relevant tests and typecheck.").mode
      ).toBe("AGENT");
      expect(router.route("show me the config loader, then rename it to loadSettings").mode).toBe("AGENT");
      expect(router.route("explain how the cache works").mode).toBe("ASK");
      // The listed word as a noun, or inside an identifier, is not a request to change anything.
      expect(router.route("explain why the fix failed").mode).toBe("ASK");
      expect(router.route("where is the add button rendered?").mode).toBe("ASK");
      expect(router.route("what does updateUser do?").mode).toBe("ASK");
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

    // A follow-up to a text answer that changed nothing revises that answer; it is not sent to AGENT
    // for its verb. But only when it is not about the workspace: after an ASK that found a bug,
    // "now fix the bug you found" is a change request, and keeping ASK would complete silently.
    it("keeps a text answer's mode for its follow-up, and only when the follow-up is not about the workspace", () => {
      const afterAnswer = { previousMode: "ASK" as const, previousChangedFiles: 0 };
      expect(router.route("add inline CSS to it", afterAnswer).mode).toBe("ASK");
      expect(router.route("make it shorter", { previousMode: "CHAT", previousChangedFiles: 0 }).mode).toBe("CHAT");
      expect(router.route("now fix the bug you found", afterAnswer).mode).toBe("AGENT");
      expect(router.route("add the button to src/app.html", afterAnswer).mode).toBe("AGENT");
      expect(router.route("give me a plan for the migration", afterAnswer).mode).toBe("PLAN");
      // After a turn that changed files, or with no session at all, the words decide as before.
      expect(router.route("add inline CSS to it", { previousMode: "ASK", previousChangedFiles: 2 }).mode).toBe("AGENT");
      expect(router.route("add inline CSS to it").mode).toBe("AGENT");
    });

    it("routes undo and revert to AGENT rather than asking what was meant", () => {
      expect(router.route("undo that").mode).toBe("AGENT");
      expect(router.route("revert the last change").mode).toBe("AGENT");
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
