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

    it("should answer CHAT with a real model call and no tools", async () => {
      const generate = vi.fn(async () => ({ text: "Hello! Ready when you are." }));
      const chatOrchestrator = new AgentOrchestrator(
        { id: "m", name: "m", getCapabilities: () => ({}) as any, generate } as any,
        {} as any, {} as any, {} as any, {} as any
      );
      const kernel = new AgentKernel(chatOrchestrator);
      const onEvent = vi.fn();
      const res = await kernel.handle({
        taskId: "test", runId: "test",
        systemPrompt: "sys", userPrompt: "Hi", workspaceRoot: "/",
        limits: {} as any, onEvent
      });
      expect(res.status).toBe("completed");
      expect(res.finalText).toBe("Hello! Ready when you are.");
      expect(generate).toHaveBeenCalledTimes(1);
      expect((generate.mock.calls[0] as any)[0].tools).toBeUndefined();
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: "task.completed",
        taskId: "test",
        finalText: res.finalText
      }));
    });

    it("should fail CHAT honestly when no model provider is available", async () => {
      const kernel = new AgentKernel(orchestrator);
      const onEvent = vi.fn();
      const res = await kernel.handle({
        taskId: "test", runId: "test",
        systemPrompt: "sys", userPrompt: "Hi", workspaceRoot: "/",
        limits: {} as any, onEvent
      });
      expect(res.status).toBe("failed");
      expect(res.finalText).toBeUndefined();
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "task.failed", taskId: "test" }));
    });
  });
});
