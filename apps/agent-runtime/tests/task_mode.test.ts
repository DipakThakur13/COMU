import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Server } from "http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";
import { createRuntimeApp } from "../src/server";
import { collectTaskEvents } from "./helpers/sse";

class EchoModel implements ModelProvider {
  id = "echo";
  name = "Echo";
  public requests: ModelRequest[] = [];
  getCapabilities() {
    return { toolCalling: true, streaming: false, reasoning: false, vision: false, structuredOutput: true, maxContextTokens: 8000 };
  }
  async generate(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push(req);
    return { text: "Here is what I found." };
  }
}

describe("POST /v1/tasks honours the requested mode (Phase 0.4)", () => {
  let server: Server;
  let baseUrl: string;
  let fixtureRoot: string;
  let sessionDir: string;
  const model = new EchoModel();

  // Each test is one task on its own. Tasks in one workspace are turns of one session, so sharing a
  // workspace would make every test after the first a follow-up to the one before it.
  beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "comu-mode-"));
    fs.writeFileSync(path.join(fixtureRoot, "README.md"), "# fixture", "utf8");
  });

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  beforeAll(async () => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-mode-sessions-"));
    const app = createRuntimeApp({ providerFactory: () => model, sessionStoreDir: sessionDir });
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
        resolve();
      });
    });
    await fetch(`${baseUrl}/v1/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { "echo-model": { apiKey: "test-only" } } })
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(sessionDir, { recursive: true, force: true });
  });

  async function startTask(body: Record<string, unknown>) {
    return fetch(`${baseUrl}/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "echo-model", workspace: { rootPath: fixtureRoot }, ...body })
    });
  }

  it("an explicit ASK mode is resolved as explicit and never asks for clarification", async () => {
    const res = await startTask({ prompt: "what do you think", mode: "ASK" });
    expect(res.status).toBe(201);
    const { taskId } = (await res.json()) as any;
    const events = await collectTaskEvents(baseUrl, taskId);

    const resolved = events.find(e => e.type === "task.mode_resolved") as any;
    expect(resolved).toMatchObject({ mode: "ASK", source: "explicit" });
    expect(events.some(e => (e as any).status === "WAITING_FOR_USER")).toBe(false);
    const terminal = events.find(e => e.type === "task.completed" || e.type === "task.failed") as any;
    expect(terminal?.type, JSON.stringify(terminal)).toBe("task.completed");
  }, 20000);

  it("AUTO mode asks a clarification question for an ambiguous prompt and continues with the answer", async () => {
    const res = await startTask({ prompt: "what do you think", mode: "AUTO" });
    expect(res.status).toBe(201);
    const { taskId } = (await res.json()) as any;
    const collecting = collectTaskEvents(baseUrl, taskId, {}, 15000);

    // The clarification is a real INPUT interaction with options.
    let interaction: any = null;
    for (let i = 0; i < 100 && !interaction; i++) {
      await new Promise(r => setTimeout(r, 50));
      const pending = await fetch(`${baseUrl}/v1/tasks/${taskId}/interactions`);
      interaction = ((await pending.json()) as any).interaction;
    }
    expect(interaction, "expected a pending clarification interaction").toBeTruthy();
    expect(interaction.type).toBe("INPUT");
    expect(interaction.options).toContain("Plan changes");

    const respond = await fetch(`${baseUrl}/v1/tasks/${taskId}/interactions/${interaction.interactionId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: { type: "INPUT", value: "Plan changes" } })
    });
    expect(respond.status).toBe(200);

    const events = await collecting;
    const resolved = events.filter(e => e.type === "task.mode_resolved") as any[];
    expect(resolved.map(e => e.mode)).toEqual(["AMBIGUOUS", "PLAN"]);
    expect(events.some(e => (e as any).status === "WAITING_FOR_USER")).toBe(true);
    expect(events.some(e => e.type === "interaction.requested")).toBe(true);
    expect(events.some(e => e.type === "interaction.responded")).toBe(true);
    const terminal = events.find(e => e.type === "task.completed" || e.type === "task.failed") as any;
    expect(terminal?.type, JSON.stringify(terminal)).toBe("task.completed");
  }, 30000);

  it("closes the SSE stream for a subscriber that connects after the task finished", async () => {
    const res = await startTask({ prompt: "what do you think", mode: "ASK" });
    const { taskId } = (await res.json()) as any;
    await collectTaskEvents(baseUrl, taskId);
    const started = Date.now();
    const replay = await collectTaskEvents(baseUrl, taskId, {}, 8000);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(replay.find(e => e.type === "task.mode_resolved")).toBeDefined();
  }, 20000);

  it("CHAT mode performs a tool-free model call and returns the model's reply", async () => {
    const before = model.requests.length;
    const res = await startTask({ prompt: "hi there, what can you do?", mode: "CHAT" });
    expect(res.status).toBe(201);
    const { taskId } = (await res.json()) as any;
    const events = await collectTaskEvents(baseUrl, taskId);

    expect(events.find(e => e.type === "task.mode_resolved")).toMatchObject({ mode: "CHAT", source: "explicit" });
    expect(events.some(e => e.type === "model_request.succeeded")).toBe(true);
    const completed = events.find(e => e.type === "task.completed") as any;
    expect(completed?.finalText).toBe("Here is what I found.");

    expect(model.requests.length).toBe(before + 1);
    const chatReq = model.requests[model.requests.length - 1];
    expect(chatReq.tools).toBeUndefined();
    expect(chatReq.systemPrompt).toContain("conversational turn");
    expect(chatReq.messages?.[0]).toMatchObject({ role: "user", content: "hi there, what can you do?" });
    expect(events.some(e => e.type === "plan.created")).toBe(false);
  }, 20000);

  it("rejects an invalid mode with 400 INVALID_MODE", async () => {
    const res = await startTask({ prompt: "hello", mode: "TURBO" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe("INVALID_MODE");
  });
});
