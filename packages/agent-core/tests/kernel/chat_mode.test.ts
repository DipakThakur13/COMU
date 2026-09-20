import { describe, it, expect, vi } from "vitest";
import { AgentOrchestrator } from "../../src/orchestrator.js";
import { AgentKernel, CHAT_SYSTEM_PROMPT } from "../../src/agent_kernel.js";
import { ProviderAuthenticationError } from "@comu/shared";

function makeKernel(generate: (...args: any[]) => Promise<any>) {
  const model = { id: "mock", name: "Mock", getCapabilities: () => ({ toolCalling: true }) as any, generate: vi.fn(generate) };
  const orchestrator = new AgentOrchestrator(model as any, {} as any, {} as any, {} as any, {} as any);
  const runSpy = vi.spyOn(orchestrator, "runWithContract");
  return { kernel: new AgentKernel(orchestrator), model, runSpy };
}

const baseInput = {
  taskId: "t-chat",
  runId: "t-chat",
  systemPrompt: "You are an AI software engineer.",
  workspaceRoot: "/home/dev/my-project",
  limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 1000 }
};

describe("CHAT mode performs a real model call (Phase 0.5)", () => {
  it("calls the model once with a conversational system prompt and no tools", async () => {
    const { kernel, model, runSpy } = makeKernel(async () => ({ text: "<think>greeting</think>Hello! What are we building today?" }));
    const events: any[] = [];
    const res = await kernel.handle({ ...baseInput, mode: "CHAT", userPrompt: "hey, refactoring later, just saying hi", onEvent: e => events.push(e) });

    expect(res.status).toBe("completed");
    expect(res.finalText).toBe("Hello! What are we building today?");
    expect(runSpy).not.toHaveBeenCalled();
    expect(model.generate).toHaveBeenCalledTimes(1);

    const req = model.generate.mock.calls[0][0];
    expect(req.tools).toBeUndefined();
    expect(req.systemPrompt).toContain(CHAT_SYSTEM_PROMPT);
    expect(req.systemPrompt).toContain("You are an AI software engineer.");
    expect(req.systemPrompt).toContain('"my-project"');
    expect(req.messages).toEqual([{ role: "user", content: "hey, refactoring later, just saying hi" }]);

    const types = events.map(e => e.type);
    expect(types).toContain("task.mode_resolved");
    expect(types).toContain("model_request.created");
    expect(types).toContain("model_request.succeeded");
    const completed = events.find(e => e.type === "task.completed");
    expect(completed.finalText).toBe("Hello! What are we building today?");
    expect(events.some(e => e.type === "agent.status" && e.status === "COMPLETED")).toBe(true);
  });

  it("AUTO-classified greetings take the same path", async () => {
    const { kernel, model } = makeKernel(async () => ({ text: "Hi!" }));
    const res = await kernel.handle({ ...baseInput, userPrompt: "Hello, how are you?", onEvent: () => {} });
    expect(res.status).toBe("completed");
    expect(res.finalText).toBe("Hi!");
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it("reports a provider failure as task.failed instead of a canned greeting", async () => {
    const { kernel } = makeKernel(async () => { throw new ProviderAuthenticationError("API key rejected"); });
    const events: any[] = [];
    const res = await kernel.handle({ ...baseInput, mode: "CHAT", userPrompt: "hi", onEvent: e => events.push(e) });

    expect(res.status).toBe("failed");
    expect(res.finalText).toBeUndefined();
    expect(res.error).toContain("API key rejected");
    const failed = events.find(e => e.type === "task.failed");
    expect(failed.error).toContain("API key rejected");
    expect(events.some(e => e.type === "task.completed")).toBe(false);
  });

  it("treats cancellation during the chat call as cancelled, not failed", async () => {
    const controller = new AbortController();
    const { kernel } = makeKernel(async (_req: any, ctx: any) => {
      controller.abort();
      const err: any = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const events: any[] = [];
    const res = await kernel.handle({ ...baseInput, mode: "CHAT", userPrompt: "hi", abortSignal: controller.signal, onEvent: e => events.push(e) });
    expect(res.status).toBe("cancelled");
    expect(events.some(e => e.type === "task.cancelled")).toBe(true);
  });
});
