import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Server } from "http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRuntimeApp, selectProvider } from "../src/server";
import { collectTaskEvents } from "./helpers/sse";

/**
 * The model a user picks is the model the provider is asked for.
 *
 * defaultProviderFactory built the NVIDIA provider without the requested modelId, so every request
 * went to the provider's built-in default (Lightning 30B-A3B) while the task, the events and B0's
 * records all named the model that was asked for. 223 requests went that way unnoticed, because the
 * event reported the name it was given, not the name that was sent.
 *
 * So this asserts on the one thing that cannot be wrong about it: the `model` field in the body of
 * the HTTP request that leaves for the provider.
 */

const NVIDIA_HOST = "integrate.api.nvidia.com";

describe("NVIDIA model selection reaches the outgoing request", () => {
  let server: Server;
  let baseUrl: string;
  let fixtureRoot: string;
  const originalFetch = globalThis.fetch;
  const sentToNvidia: any[] = [];

  beforeAll(async () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "comu-model-"));
    fs.writeFileSync(path.join(fixtureRoot, "README.md"), "# fixture", "utf8");

    // Everything bound for NVIDIA is captured and answered here; nothing reaches the network.
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input?.url ?? String(input);
      if (!url.includes(NVIDIA_HOST)) return originalFetch(input, init);
      const body = JSON.parse(String(init?.body ?? "{}"));
      sentToNvidia.push(body);
      if (body.stream) {
        const chunk = { choices: [{ index: 0, delta: { content: "Hello." }, finish_reason: "stop" }] };
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" }
        });
      }
      return new Response(
        JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: "Hello." }, finish_reason: "stop" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    const app = createRuntimeApp();
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
        resolve();
      });
    });
    const cfg = await fetch(`${baseUrl}/v1/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { nvidia: { apiKey: "stand-in-never-sent-anywhere" } } })
    });
    expect(cfg.status).toBe(200);
  });

  beforeEach(() => {
    sentToNvidia.length = 0;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  const startTask = (body: Record<string, unknown>) =>
    fetch(`${baseUrl}/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Say hello.", mode: "CHAT", workspace: { rootPath: fixtureRoot }, ...body })
    });

  // Neither is the provider's built-in default, so a dropped modelId cannot pass by coincidence.
  for (const modelId of ["nvidia/nemotron-3-ultra-550b-a55b", "moonshotai/kimi-k3"]) {
    it(`sends ${modelId} when ${modelId} is chosen`, async () => {
      const res = await startTask({ modelId });
      expect(res.status).toBe(201);
      const { taskId } = (await res.json()) as any;
      const events = await collectTaskEvents(baseUrl, taskId);

      expect(events.some(e => e.type === "task.completed")).toBe(true);
      expect(sentToNvidia.length).toBeGreaterThan(0);
      for (const body of sentToNvidia) expect(body.model).toBe(modelId);
    });
  }

  it("routes every model in the NVIDIA catalogue to NVIDIA, not only ids that contain 'nvidia'", () => {
    for (const id of ["moonshotai/kimi-k3", "poolside/laguna-xs-2.1", "meta/muse-glimmer-30b", "deepseek-ai/deepseek-v4-pro-0813"]) {
      expect(selectProvider(id).providerId).toBe("nvidia");
    }
  });

  it("refuses a task that names no model, rather than choosing one silently", async () => {
    const res = await startTask({});
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("MODEL_REQUIRED");
    expect(sentToNvidia).toHaveLength(0);
  });

  it("refuses an unknown model id and names the ones it accepts", async () => {
    // The old default setting: it contains "nemotron", so it used to route to NVIDIA and then be
    // replaced by the built-in default without a word.
    const res = await startTask({ modelId: "nvidia-nemotron-3-ultra" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("UNKNOWN_MODEL");
    expect(body.message).toContain("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(sentToNvidia).toHaveLength(0);
  });
});
