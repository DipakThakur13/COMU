import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  const model = new EchoModel();

  beforeAll(async () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "comu-mode-"));
    fs.writeFileSync(path.join(fixtureRoot, "README.md"), "# fixture", "utf8");
    const app = createRuntimeApp({ providerFactory: () => model });
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
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
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

  it("AUTO mode classifies the same ambiguous prompt and waits for the user", async () => {
    const res = await startTask({ prompt: "what do you think", mode: "AUTO" });
    expect(res.status).toBe(201);
    const { taskId } = (await res.json()) as any;
    const events = await collectTaskEvents(baseUrl, taskId, {}, 8000);
    const resolved = events.find(e => e.type === "task.mode_resolved") as any;
    expect(resolved).toMatchObject({ mode: "AMBIGUOUS" });
    expect(events.some(e => (e as any).status === "WAITING_FOR_USER")).toBe(true);
    expect(model.requests.length).toBe(1); // only the explicit-ASK task above called the model
  }, 20000);

  it("closes the SSE stream for a subscriber that connects after the task finished", async () => {
    const res = await startTask({ prompt: "what do you think", mode: "ASK" });
    const { taskId } = (await res.json()) as any;
    await collectTaskEvents(baseUrl, taskId);
    const started = Date.now();
    const replay = await collectTaskEvents(baseUrl, taskId, {}, 8000);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(replay.find(e => e.type === "task.mode_resolved")).toBeDefined();
  }, 20000);

  it("rejects an invalid mode with 400 INVALID_MODE", async () => {
    const res = await startTask({ prompt: "hello", mode: "TURBO" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe("INVALID_MODE");
  });
});
