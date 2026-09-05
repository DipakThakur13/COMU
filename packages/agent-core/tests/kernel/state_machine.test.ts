import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentOrchestrator } from "../../src/orchestrator.js";
import { AgentKernel } from "../../src/agent_kernel.js";
import { AgentState } from "../../src/interfaces.js";

describe("Agent Kernel & State Machine (Batch 2)", () => {
  let orchestrator: any;

  beforeEach(() => {
    // Mock dependencies for AgentOrchestrator
    orchestrator = new AgentOrchestrator(
      {} as any, {} as any, {} as any, {} as any, {} as any
    );
  });

  describe("State Transitions", () => {
    it("should allow IDLE -> STARTING -> CLASSIFYING", () => {
      const ctx = { taskId: "test", onEvent: vi.fn() };
      
      expect(() => orchestrator.transition(ctx, "STARTING")).not.toThrow();
      expect(orchestrator.getState()).toBe("STARTING");

      expect(() => orchestrator.transition(ctx, "CLASSIFYING")).not.toThrow();
      expect(orchestrator.getState()).toBe("CLASSIFYING");
    });

    it("should reject IDLE -> TOOL_CALLING", () => {
      const ctx = { taskId: "test", onEvent: vi.fn() };
      expect(() => orchestrator.transition(ctx, "TOOL_CALLING")).toThrow(/Invalid state transition/);
    });

    it("should reject CHAT mode entering TOOL_CALLING", () => {
      const ctx = { taskId: "test", onEvent: vi.fn() };
      orchestrator.transition(ctx, "STARTING");
      orchestrator.transition(ctx, "CLASSIFYING");
      orchestrator.transition(ctx, "THINKING");
      
      const contract = { mode: "CHAT" };
      expect(() => orchestrator.transition(ctx, "TOOL_CALLING", "", contract)).toThrow(/CHAT mode cannot enter TOOL_CALLING/);
    });
  });

  describe("AgentKernel integration", () => {
    it("should generate clarification on AMBIGUOUS", async () => {
      const kernel = new AgentKernel(orchestrator);
      const res = await kernel.handle({
        taskId: "test", runId: "test",
        systemPrompt: "sys", userPrompt: "take a look at this",
        workspaceRoot: "/", limits: {} as any, onEvent: vi.fn()
      });
      expect(res.status).toBe("waiting_for_user");
      expect(res.finalText).toContain("What would you like me to do");
    });

    it("should return immediately on CHAT", async () => {
      const kernel = new AgentKernel(orchestrator);
      const res = await kernel.handle({
        taskId: "test", runId: "test",
        systemPrompt: "sys", userPrompt: "Hi",
        workspaceRoot: "/", limits: {} as any, onEvent: vi.fn()
      });
      expect(res.status).toBe("completed");
      expect(res.finalText).toContain("Hi! I'm COMU");
    });
  });
});
