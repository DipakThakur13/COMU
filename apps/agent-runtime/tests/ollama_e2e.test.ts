import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Server } from "http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRuntimeApp, selectProvider, defaultProviderFactory } from "../src/server";
import { collectTaskEvents } from "./helpers/sse";
import { startFakeOllama, FakeOllama } from "./helpers/fake_ollama";

describe("Ollama local provider end to end (Phase 0.3)", () => {
  let server: Server;
  let baseUrl: string;
  let fixtureRoot: string;
  let ollama: FakeOllama;
  const originalFetch = globalThis.fetch;
  const outboundUrls: string[] = [];

  beforeAll(async () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "comu-ollama-"));
    fs.writeFileSync(path.join(fixtureRoot, "README.md"), "# fixture", "utf8");

    ollama = await startFakeOllama({ models: ["llama3.1:8b", "qwen2.5-coder:7b"] });

    // Record every outbound fetch the runtime makes so we can prove nothing left the loopback.
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input?.url ?? String(input);
      outboundUrls.push(url);
      return originalFetch(input, init);
    }) as any;

    const app = createRuntimeApp();
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
        resolve();
      });
    });

    // Point the runtime's Ollama endpoint at the fake daemon (the extension pushes this the same way).
    const cfg = await fetch(`${baseUrl}/v1/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { ollama: { endpoint: ollama.baseUrl } } })
    });
    expect(cfg.status).toBe(200);
  });

  afterEach(() => {
    delete process.env.NVIDIA_API_KEY;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await ollama.close();
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("routes every local model id to the Ollama provider, never NVIDIA", () => {
    expect(selectProvider("ollama:llama3.1").providerId).toBe("ollama");
    expect(selectProvider("ollama-llama-3").providerId).toBe("ollama");
    expect(selectProvider("nvidia/nemotron-3.5-lightning-30b-a3b").providerId).toBe("nvidia");
    const provider = defaultProviderFactory(selectProvider("ollama:qwen2.5-coder:7b"), { ollama: { endpoint: ollama.baseUrl } });
    expect(provider.id).toBe("ollama");
    expect((provider as any).selectedModel).toBe("qwen2.5-coder:7b");
  });

  it("reports honest Ollama status and installed models in the provider catalogue", async () => {
    const res = await fetch(`${baseUrl}/v1/config/providers`);
    const data = (await res.json()) as any;
    const entry = data.providers.find((p: any) => p.providerId === "ollama");
    expect(entry.status).toBe("CONNECTED");
    expect(entry.isLocal).toBe(true);
    expect(entry.endpoint).toBe(ollama.baseUrl);
    expect(entry.models.map((m: any) => m.id)).toEqual(["ollama:llama3.1:8b", "ollama:qwen2.5-coder:7b"]);

    const test = await fetch(`${baseUrl}/v1/config/providers/ollama/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    expect(((await test.json()) as any).status).toBe("CONNECTED");
  });

  it("runs a task against the local Ollama daemon end to end without contacting NVIDIA", async () => {
    outboundUrls.length = 0;
    ollama.requests.length = 0;

    const res = await fetch(`${baseUrl}/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Explain what this repository does",
        modelId: "ollama:llama3.1:8b",
        workspace: { rootPath: fixtureRoot }
      })
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { taskId } = (await res.json()) as any;

    const events = await collectTaskEvents(baseUrl, taskId);
    const terminal = events.find(e => e.type === "task.completed" || e.type === "task.failed") as any;
    expect(terminal?.type, JSON.stringify(terminal)).toBe("task.completed");
    expect(terminal.finalText).toContain("fixture project");

    // The model call went to the fake daemon's OpenAI-compatible endpoint with the bare model name and no credential.
    const chat = ollama.requests.filter(r => r.url === "/v1/chat/completions");
    expect(chat.length).toBeGreaterThan(0);
    expect(chat[0].body.model).toBe("llama3.1:8b");
    expect(chat[0].headers.authorization).toBeUndefined();

    // Nothing left the loopback interface.
    const external = outboundUrls.filter(u => !u.startsWith(baseUrl) && !u.startsWith(ollama.baseUrl));
    expect(external).toEqual([]);
    expect(outboundUrls.some(u => u.includes("nvidia"))).toBe(false);
  });

  it("refuses to start a local task when Ollama is unreachable, instead of failing inside the task", async () => {
    const unreachable = await startFakeOllama();
    const deadUrl = unreachable.baseUrl;
    await unreachable.close();

    await fetch(`${baseUrl}/v1/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { ollama: { endpoint: deadUrl } } })
    });

    const res = await fetch(`${baseUrl}/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Explain this", modelId: "ollama:llama3.1", workspace: { rootPath: fixtureRoot } })
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe("PROVIDER_NOT_REACHABLE");
    expect(body.providerId).toBe("ollama");

    const list = await fetch(`${baseUrl}/v1/config/providers`);
    const entry = ((await list.json()) as any).providers.find((p: any) => p.providerId === "ollama");
    expect(entry.status).not.toBe("CONNECTED");

    // restore the live fake for any later test
    await fetch(`${baseUrl}/v1/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { ollama: { endpoint: ollama.baseUrl } } })
    });
  });
});
