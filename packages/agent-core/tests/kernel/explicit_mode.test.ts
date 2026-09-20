import { describe, it, expect, vi } from "vitest";
import { AgentOrchestrator } from "../../src/orchestrator.js";
import { AgentKernel } from "../../src/agent_kernel.js";
import { TaskContract } from "../../src/interaction/task_contract.js";

function makeKernel() {
  const orchestrator = new AgentOrchestrator({} as any, {} as any, {} as any, {} as any, {} as any);
  const runSpy = vi.spyOn(orchestrator, "runWithContract").mockResolvedValue({ status: "completed", steps: 0 } as any);
  return { kernel: new AgentKernel(orchestrator), runSpy };
}

const baseInput = {
  taskId: "t-mode",
  runId: "t-mode",
  systemPrompt: "sys",
  workspaceRoot: "/repo",
  limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 1000 }
};

describe("AgentKernel honours an explicit mode (Phase 0.4)", () => {
  it("forces AGENT regardless of prompt wording that would otherwise be AMBIGUOUS", async () => {
    const { kernel, runSpy } = makeKernel();
    const events: any[] = [];
    const res = await kernel.handle({ ...baseInput, mode: "AGENT", userPrompt: "take a look at this", onEvent: e => events.push(e) });

    expect(res.status).toBe("completed");
    expect(runSpy).toHaveBeenCalledTimes(1);
    const contract = runSpy.mock.calls[0][1] as TaskContract;
    expect(contract.mode).toBe("AGENT");
    expect(contract.allowedCapabilities).toEqual(["read", "write", "execute"]);
    expect(contract.expectedMutation).toBe(true);

    const resolved = events.find(e => e.type === "task.mode_resolved");
    expect(resolved).toMatchObject({ mode: "AGENT", source: "explicit", confidence: 1 });
    expect(events.some(e => e.status === "WAITING_FOR_USER")).toBe(false);
  });

  it("forces ASK (read-only contract) even for an implementation-sounding prompt", async () => {
    const { kernel, runSpy } = makeKernel();
    await kernel.handle({ ...baseInput, mode: "ASK", userPrompt: "fix the failing login tests", onEvent: () => {} });
    const contract = runSpy.mock.calls[0][1] as TaskContract;
    expect(contract.mode).toBe("ASK");
    expect(contract.allowedCapabilities).toEqual(["read"]);
    expect(contract.expectedMutation).toBe(false);
  });

  it("forces PLAN for a prompt the router would classify as AGENT", async () => {
    const { kernel, runSpy } = makeKernel();
    await kernel.handle({ ...baseInput, mode: "PLAN", userPrompt: "implement dark mode across the app", onEvent: () => {} });
    expect((runSpy.mock.calls[0][1] as TaskContract).mode).toBe("PLAN");
  });

  it("AUTO (or no mode) still goes through the router", async () => {
    const { kernel, runSpy } = makeKernel();
    const events: any[] = [];
    const res = await kernel.handle({ ...baseInput, mode: "AUTO", userPrompt: "take a look at this", onEvent: e => events.push(e) });
    expect(res.status).toBe("waiting_for_user");
    expect(runSpy).not.toHaveBeenCalled();
    expect(events.find(e => e.type === "task.mode_resolved")).toMatchObject({ mode: "AMBIGUOUS", source: "deterministic" });

    const { kernel: k2, runSpy: s2 } = makeKernel();
    await k2.handle({ ...baseInput, userPrompt: "fix the failing tests", onEvent: () => {} });
    expect((s2.mock.calls[0][1] as TaskContract).mode).toBe("AGENT");
  });

  it("rejects an unknown mode instead of guessing", async () => {
    const { kernel } = makeKernel();
    await expect(
      kernel.handle({ ...baseInput, mode: "YOLO" as any, userPrompt: "do things", onEvent: () => {} })
    ).rejects.toThrow(/INVALID_MODE/);
  });
});
