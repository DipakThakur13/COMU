import { describe, it, expect, vi, afterEach } from "vitest";
import { OllamaProvider, OLLAMA_CAPABILITY_PROFILE } from "../src/index.js";

const originalFetch = globalThis.fetch;
const originalHost = process.env.OLLAMA_HOST;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalHost === undefined) delete process.env.OLLAMA_HOST;
  else process.env.OLLAMA_HOST = originalHost;
});

describe("OllamaProvider (local, keyless)", () => {
  it("normalizes base URLs from any of the accepted spellings", () => {
    delete process.env.OLLAMA_HOST;
    expect(OllamaProvider.normalizeBaseUrl(undefined)).toBe("http://127.0.0.1:11434");
    expect(OllamaProvider.normalizeBaseUrl("http://localhost:11434/")).toBe("http://localhost:11434");
    expect(OllamaProvider.normalizeBaseUrl("http://localhost:11434/v1")).toBe("http://localhost:11434");
    expect(OllamaProvider.normalizeBaseUrl("http://localhost:11434/v1/chat/completions")).toBe("http://localhost:11434");
    expect(OllamaProvider.normalizeBaseUrl("gpu-box:11434")).toBe("http://gpu-box:11434");
    process.env.OLLAMA_HOST = "http://10.0.0.5:11434";
    expect(OllamaProvider.normalizeBaseUrl(undefined)).toBe("http://10.0.0.5:11434");
    expect(OllamaProvider.normalizeBaseUrl("http://explicit:1")).toBe("http://explicit:1");
  });

  it("maps COMU model ids to Ollama model names, including the legacy id", () => {
    expect(OllamaProvider.toOllamaModelName("ollama:qwen2.5-coder:7b")).toBe("qwen2.5-coder:7b");
    expect(OllamaProvider.toOllamaModelName("ollama:llama3.1")).toBe("llama3.1");
    expect(OllamaProvider.toOllamaModelName("ollama-llama-3")).toBe("llama3");
    expect(OllamaProvider.toOllamaModelName("ollama-deepseek-coder")).toBe("deepseek-coder");
    expect(OllamaProvider.toOllamaModelName(undefined)).toBe(OllamaProvider.DEFAULT_MODEL);
    expect(OllamaProvider.toOllamaModelName("ollama:")).toBe(OllamaProvider.DEFAULT_MODEL);
    expect(OllamaProvider.toComuModelId("llama3.1:8b")).toBe("ollama:llama3.1:8b");
    expect(OllamaProvider.isOllamaModelId("ollama:llama3.1")).toBe(true);
    expect(OllamaProvider.isOllamaModelId("ollama-llama-3")).toBe(true);
    expect(OllamaProvider.isOllamaModelId("nvidia/nemotron")).toBe(false);
  });

  it("constructs without an API key and reports local capabilities", () => {
    delete process.env.OLLAMA_HOST;
    const provider = new OllamaProvider(undefined, "ollama:llama3.1");
    expect(provider.id).toBe("ollama");
    expect(provider.providerId).toBe("ollama");
    expect(provider.selectedModel).toBe("llama3.1");
    expect(provider.baseUrl).toBe("http://127.0.0.1:11434");
    expect(provider.profile).toBe(OLLAMA_CAPABILITY_PROFILE);
    expect(provider.getCapabilities().toolCalling).toBe(true);
    expect(provider.getCapabilities().longContext).toBe(false);
  });

  it("sends chat requests to <base>/v1/chat/completions with no Authorization header", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "hello from llama" } }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;

    const provider = new OllamaProvider("http://127.0.0.1:11434", "ollama:llama3.1");
    const res = await provider.generate({ prompt: "hi", stream: false } as any);

    expect(res.text).toBe("hello from llama");
    expect(res.usage?.totalTokens).toBe(7);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(Object.keys(headers).map(h => h.toLowerCase())).not.toContain("authorization");
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe("llama3.1");
  });

  it("probe() reports CONNECTED with installed models, using only /api/tags", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any) => {
      urls.push(String(url));
      return new Response(JSON.stringify({
        models: [
          { name: "llama3.1:8b", size: 123, details: { parameter_size: "8B", family: "llama" } },
          { name: "qwen2.5-coder:7b", size: 456, details: { parameter_size: "7B", family: "qwen2" } }
        ]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;

    const models = await OllamaProvider.listModels("http://127.0.0.1:11434/v1");
    expect(models.map(m => m.id)).toEqual(["ollama:llama3.1:8b", "ollama:qwen2.5-coder:7b"]);
    expect(models[0].parameterSize).toBe("8B");

    const result = await OllamaProvider.probe("http://127.0.0.1:11434");
    expect(result.status).toBe("CONNECTED");
    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("llama3.1:8b");
    expect(urls.every(u => u === "http://127.0.0.1:11434/api/tags")).toBe(true);
  });

  it("probe() reports CONNECTION_ERROR when the daemon is not running", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("fetch failed"); }) as any;
    const result = await OllamaProvider.probe("http://127.0.0.1:1");
    expect(result.status).toBe("CONNECTION_ERROR");
    expect(result.message).toContain("127.0.0.1:1");
  });

  it("probe() reports CONNECTED with guidance when no models are installed", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })) as any;
    const result = await OllamaProvider.probe("http://127.0.0.1:11434");
    expect(result.status).toBe("CONNECTED");
    expect(result.message).toContain("ollama pull");
  });
});
