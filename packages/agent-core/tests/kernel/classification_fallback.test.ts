import { describe, it, expect, vi } from "vitest";
import { IntentRouter, stripPoliteness } from "../../src/interaction/intent_router.js";
import { ModelIntentClassifier, INTENT_CLASSIFIER_SYSTEM_PROMPT } from "../../src/interaction/model_intent_classifier.js";
import { AgentOrchestrator } from "../../src/orchestrator.js";
import { AgentKernel } from "../../src/agent_kernel.js";
import { InteractionManager } from "../../src/interaction_manager.js";
import { TaskContract } from "../../src/interaction/task_contract.js";

describe("IntentRouter deterministic path ignores politeness (Phase 0.6)", () => {
  const router = new IntentRouter();

  it("strips leading politeness and framing", () => {
    expect(stripPoliteness("please fix the login bug")).toBe("fix the login bug");
    expect(stripPoliteness("Could you please add a logout button")).toBe("add a logout button");
    expect(stripPoliteness("hey comu, would you explain the auth flow?")).toBe("explain the auth flow?");
    expect(stripPoliteness("I need you to refactor the parser")).toBe("refactor the parser");
    expect(stripPoliteness("fix it")).toBe("fix it");
  });

  it("classifies polite requests like their bare form", () => {
    expect(router.route("please fix the login bug").mode).toBe("AGENT");
    expect(router.route("could you add a logout button to the navbar").mode).toBe("AGENT");
    expect(router.route("would you explain how sessions are stored").mode).toBe("ASK");
    expect(router.route("can you give me a plan for migrating to ESM").mode).toBe("PLAN");
    expect(router.route("I need you to create a Dockerfile").mode).toBe("AGENT");
  });

  it("keeps greetings as CHAT and bare pointers as AMBIGUOUS", () => {
    expect(router.route("Hi").mode).toBe("CHAT");
    expect(router.route("Hello, how are you?").mode).toBe("CHAT");
    expect(router.route("thanks!").mode).toBe("CHAT");
    expect(router.route("take a look at this").mode).toBe("AMBIGUOUS");
  });
});

describe("ModelIntentClassifier", () => {
  function classifier(generate: (...args: any[]) => Promise<any>, events: any[] = []) {
    const model = { id: "m", name: "m", getCapabilities: () => ({}) as any, generate: vi.fn(generate) };
    return { model, clf: new ModelIntentClassifier(model as any, e => events.push(e)) };
  }

  it("parses a JSON verdict and returns a model-sourced classification", async () => {
    const { model, clf } = classifier(async () => ({ text: '{"mode":"AGENT","confidence":0.92,"reason":"asks to change code"}' }));
    const res = await clf.classify("the checkout page shows the wrong total after a coupon", "t", "t");
    expect(res).toMatchObject({ mode: "AGENT", confidence: 0.92, source: "model", requiresClarification: false });
    const req = model.generate.mock.calls[0][0];
    expect(req.systemPrompt).toBe(INTENT_CLASSIFIER_SYSTEM_PROMPT);
    expect(req.tools).toBeUndefined();
    expect(req.temperature).toBe(0);
  });

  it("tolerates prose and think tags around the JSON", () => {
    expect(ModelIntentClassifier.parseReply('<think>hmm</think>Sure: {"mode": "ask", "confidence": "0.8"} done')).toEqual({
      mode: "ASK", confidence: 0.8, reason: undefined
    });
    expect(ModelIntentClassifier.parseReply("no json here")).toBeNull();
    expect(ModelIntentClassifier.parseReply('{"mode":"TURBO","confidence":1}')).toBeNull();
  });

  it("treats low confidence, AMBIGUOUS verdicts, garbage and provider errors as AMBIGUOUS", async () => {
    const low = await classifier(async () => ({ text: '{"mode":"AGENT","confidence":0.3}' })).clf.classify("x", "t", "t");
    expect(low).toMatchObject({ mode: "AMBIGUOUS", source: "model", requiresClarification: true });

    const amb = await classifier(async () => ({ text: '{"mode":"AMBIGUOUS","confidence":0.9}' })).clf.classify("x", "t", "t");
    expect(amb.mode).toBe("AMBIGUOUS");

    const garbage = await classifier(async () => ({ text: "Here is what I found." })).clf.classify("x", "t", "t");
    expect(garbage).toMatchObject({ mode: "AMBIGUOUS", source: "fallback" });

    const boom = await classifier(async () => { throw new Error("provider down"); }).clf.classify("x", "t", "t");
    expect(boom).toMatchObject({ mode: "AMBIGUOUS", source: "fallback" });
    expect(boom.reasons[0]).toContain("provider down");
  });
});

describe("AgentKernel AUTO routing with model fallback and clarification", () => {
  function setup(generate: (...args: any[]) => Promise<any>, withInteractions = true) {
    const model = { id: "m", name: "m", getCapabilities: () => ({}) as any, generate: vi.fn(generate) };
    const interactionManager = withInteractions ? new InteractionManager(2000) : undefined;
    const orchestrator = new AgentOrchestrator(model as any, {} as any, {} as any, {} as any, { interactionManager });
    const runSpy = vi.spyOn(orchestrator, "runWithContract").mockResolvedValue({ status: "completed", steps: 0 } as any);
    return { model, interactionManager, kernel: new AgentKernel(orchestrator), runSpy };
  }
  const base = { taskId: "t-auto", runId: "t-auto", systemPrompt: "sys", workspaceRoot: "/repo", limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 1000 } };

  it("uses the model to classify a prompt the regexes cannot place, without asking the user", async () => {
    const { model, kernel, runSpy } = setup(async () => ({ text: '{"mode":"AGENT","confidence":0.9,"reason":"bug report"}' }));
    const events: any[] = [];
    const res = await kernel.handle({ ...base, userPrompt: "the checkout page shows the wrong total after applying a coupon", onEvent: e => events.push(e) });

    expect(res.status).toBe("completed");
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect((runSpy.mock.calls[0][1] as TaskContract).mode).toBe("AGENT");
    expect(events.find(e => e.type === "task.mode_resolved")).toMatchObject({ mode: "AGENT", source: "model" });
    expect(events.some(e => e.type === "interaction.requested")).toBe(false);
  });

  it("does not call the model when the deterministic path already decides", async () => {
    const { model, kernel, runSpy } = setup(async () => ({ text: '{"mode":"CHAT","confidence":1}' }));
    await kernel.handle({ ...base, userPrompt: "please fix the failing login tests", onEvent: () => {} });
    expect(model.generate).not.toHaveBeenCalled();
    expect((runSpy.mock.calls[0][1] as TaskContract).mode).toBe("AGENT");
  });

  it("asks for clarification only when the model is uncertain, and honours the chosen option", async () => {
    const { model, kernel, runSpy, interactionManager } = setup(async () => ({ text: '{"mode":"ASK","confidence":0.4}' }));
    const events: any[] = [];
    const pending = kernel.handle({ ...base, userPrompt: "the thing from yesterday", onEvent: e => events.push(e) });

    // wait for the clarification card
    let interaction: any;
    for (let i = 0; i < 50 && !interaction; i++) {
      await new Promise(r => setTimeout(r, 10));
      interaction = interactionManager!.getPendingInteraction(base.taskId);
    }
    expect(interaction).toBeDefined();
    expect(interaction.type).toBe("INPUT");
    expect(interaction.options).toEqual(["Explain it", "Review it", "Plan changes", "Make changes"]);
    expect(events.some(e => e.type === "agent.status" && e.status === "WAITING_FOR_USER")).toBe(true);

    interactionManager!.resolveInteraction(base.taskId, interaction.interactionId, { type: "INPUT", value: "Make changes" }, e => events.push(e));
    const res = await pending;

    expect(res.status).toBe("completed");
    const contract = runSpy.mock.calls[0][1] as TaskContract;
    expect(contract.mode).toBe("AGENT");
    expect(contract.goal).toContain("[User clarification]: Make changes");
    const resolved = events.filter(e => e.type === "task.mode_resolved");
    expect(resolved.map(e => e.mode)).toEqual(["AMBIGUOUS", "AGENT"]);
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it("re-routes a free-text clarification and defaults to read-only ASK if still unclear", async () => {
    const replies = ['{"mode":"AMBIGUOUS","confidence":0.2}', '{"mode":"AMBIGUOUS","confidence":0.2}'];
    const { kernel, runSpy, interactionManager } = setup(async () => ({ text: replies.shift() }));
    const pending = kernel.handle({ ...base, userPrompt: "the thing from yesterday", onEvent: () => {} });
    let interaction: any;
    for (let i = 0; i < 50 && !interaction; i++) {
      await new Promise(r => setTimeout(r, 10));
      interaction = interactionManager!.getPendingInteraction(base.taskId);
    }
    interactionManager!.resolveInteraction(base.taskId, interaction.interactionId, { type: "INPUT", value: "the one we talked about" });
    await pending;
    const contract = runSpy.mock.calls[0][1] as TaskContract;
    expect(contract.mode).toBe("ASK");
    expect(contract.allowedCapabilities).toEqual(["read", "network"]);
  });

  it("fails honestly when the clarification expires", async () => {
    const model = { id: "m", name: "m", getCapabilities: () => ({}) as any, generate: vi.fn(async () => ({ text: "???" })) };
    const interactionManager = new InteractionManager(50);
    const orchestrator = new AgentOrchestrator(model as any, {} as any, {} as any, {} as any, { interactionManager });
    const runSpy = vi.spyOn(orchestrator, "runWithContract");
    const kernel = new AgentKernel(orchestrator);
    const events: any[] = [];
    const res = await kernel.handle({ ...base, userPrompt: "the thing from yesterday", onEvent: e => events.push(e) });
    expect(res.status).toBe("failed");
    expect(runSpy).not.toHaveBeenCalled();
    expect(events.find(e => e.type === "task.failed")?.payload?.code).toBe("CLARIFICATION_TIMEOUT");
  });

  it("keeps the legacy waiting_for_user return when no interaction manager is wired", async () => {
    const { kernel, runSpy } = setup(async () => ({ text: '{"mode":"AMBIGUOUS","confidence":0.1}' }), false);
    const res = await kernel.handle({ ...base, userPrompt: "the thing from yesterday", onEvent: () => {} });
    expect(res.status).toBe("waiting_for_user");
    expect(res.finalText).toContain("What would you like me to do");
    expect(runSpy).not.toHaveBeenCalled();
  });
});
