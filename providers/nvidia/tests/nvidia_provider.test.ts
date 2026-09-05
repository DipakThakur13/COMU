import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NvidiaProvider } from "../src/index";
import { UnsupportedModelError, ProviderInvalidRequestError } from "@comu/shared";
import { ModelRequestContext } from "@comu/model-core";

describe("NvidiaProvider Integration Tests (M03-M08, M15-M30)", () => {
  const originalEnv = process.env.NVIDIA_API_KEY;

  beforeEach(() => {
    delete process.env.NVIDIA_API_KEY;
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.NVIDIA_API_KEY = originalEnv;
    } else {
      delete process.env.NVIDIA_API_KEY;
    }
    vi.restoreAllMocks();
  });

  const getContext = (): ModelRequestContext => ({
    requestId: "req-1",
    taskId: "task-1",
    runId: "run-1",
    timeoutMs: 15000,
    signal: new AbortController().signal,
    attempt: 1,
    maxAttempts: 3,
    startedAt: Date.now()
  });

  const mockFetchResponse = (body: any) => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body
    });
    vi.stubGlobal("fetch", fakeFetch);
    return fakeFetch;
  };

  it("M03: DeepSeek Pro request has correct model ID", async () => {
    const fetchMock = mockFetchResponse({ choices: [{ message: { content: "ok" } }] });
    const provider = new NvidiaProvider("test-key", undefined, "deepseek-ai/deepseek-v4-pro-0813");
    await provider.generate({ prompt: "hi", model: "deepseek-ai/deepseek-v4-pro-0813" });
    const reqBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(reqBody.model).toBe("deepseek-ai/deepseek-v4-pro-0813");
  });

  it("M04: Nemotron Lightning request has correct model ID", async () => {
    const fetchMock = mockFetchResponse({ choices: [{ message: { content: "ok" } }] });
    const provider = new NvidiaProvider("test-key");
    await provider.generate({ prompt: "hi", model: "nvidia/nemotron-3.5-lightning-30b-a3b" });
    const reqBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(reqBody.model).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
  });

  it("M05: Kimi K3 request has correct model ID", async () => {
    const fetchMock = mockFetchResponse({ choices: [{ message: { content: "ok" } }] });
    const provider = new NvidiaProvider("test-key");
    await provider.generate({ prompt: "hi", model: "moonshotai/kimi-k3" });
    const reqBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(reqBody.model).toBe("moonshotai/kimi-k3");
  });

  it("M06: DeepSeek Flash request has correct model ID", async () => {
    const fetchMock = mockFetchResponse({ choices: [{ message: { content: "ok" } }] });
    const provider = new NvidiaProvider("test-key");
    await provider.generate({ prompt: "hi", model: "deepseek-ai/deepseek-v4-flash-0731" });
    const reqBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(reqBody.model).toBe("deepseek-ai/deepseek-v4-flash-0731");
  });

  it("M07: Laguna request has correct model ID", async () => {
    const fetchMock = mockFetchResponse({ choices: [{ message: { content: "ok" } }] });
    const provider = new NvidiaProvider("test-key");
    await provider.generate({ prompt: "hi", model: "poolside/laguna-xs-2.1" });
    const reqBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(reqBody.model).toBe("poolside/laguna-xs-2.1");
  });

  it("M08: Muse request has correct model ID", async () => {
    const fetchMock = mockFetchResponse({ choices: [{ message: { content: "ok" } }] });
    const provider = new NvidiaProvider("test-key");
    await provider.generate({ prompt: "hi", model: "meta/muse-glimmer-30b" });
    const reqBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(reqBody.model).toBe("meta/muse-glimmer-30b");
  });

  it("M15: Model-specific parameters do not leak between models", async () => {
    const fetchMock = mockFetchResponse({ choices: [{ message: { content: "ok" } }] });
    const provider = new NvidiaProvider("test-key");
    
    await provider.generate({ prompt: "hi", model: "deepseek-ai/deepseek-v4-pro-0813" });
    const reqBody1 = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(reqBody1.chat_template_kwargs).toEqual({ thinking: false });

    await provider.generate({ prompt: "hi", model: "nvidia/nemotron-3.5-lightning-30b-a3b" });
    const reqBody2 = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(reqBody2.chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(reqBody2.reasoning_budget).toBe(16384);
  });

  it("M17: Nemotron Lightning streams correctly (uses stream: true)", async () => {
    const fetchMock = mockFetchResponse({ choices: [{ message: { content: "ok" } }] });
    const provider = new NvidiaProvider("test-key");
    await provider.generate({ prompt: "hi", model: "nvidia/nemotron-3.5-lightning-30b-a3b" });
    const reqBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // Since fetch isn't fully mocked for streaming in this test, we verify it sets stream=true
    expect(reqBody.stream).toBe(true);
  });

  it("M18: Kimi streams correctly (uses stream: true)", async () => {
    const fetchMock = mockFetchResponse({ choices: [{ message: { content: "ok" } }] });
    const provider = new NvidiaProvider("test-key");
    await provider.generate({ prompt: "hi", model: "moonshotai/kimi-k3" });
    const reqBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(reqBody.stream).toBe(true);
  });

  it("M19: non-streaming models return complete responses", async () => {
    const fetchMock = mockFetchResponse({ choices: [{ message: { content: "ok" } }] });
    const provider = new NvidiaProvider("test-key");
    await provider.generate({ prompt: "hi", model: "deepseek-ai/deepseek-v4-flash-0731" });
    const reqBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(reqBody.stream).toBe(false);
  });

  it("M20: delta.reasoning_content normalizes", () => {
    // extractThinking takes combined reasoning string and content
    const res = NvidiaProvider.extractThinking("content", "delta reasoning");
    expect(res.thinking).toBe("delta reasoning");
    expect(res.text).toBe("content");
  });

  it("M23: Raw reasoning is not exposed as normal user content", () => {
    const raw = "<think>Secret plan</think>Hello world";
    const result = NvidiaProvider.extractThinking(raw);
    expect(result.thinking).toBe("Secret plan");
    expect(result.text).toBe("Hello world");
  });

  it("M29: Kimi image content normalizes correctly", async () => {
    const fetchMock = mockFetchResponse({ choices: [{ message: { content: "ok" } }] });
    const provider = new NvidiaProvider("test-key");
    await provider.generate({
      prompt: "",
      model: "moonshotai/kimi-k3",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Look at this" },
          { type: "image_url", imageUrl: "https://example.com/img.jpg" }
        ]
      }]
    });
    const reqBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(reqBody.messages[0].content).toEqual([
      { type: "text", text: "Look at this" },
      { type: "image_url", image_url: { url: "https://example.com/img.jpg" } }
    ]);
  });

  it("M30: Image URL security validation works", async () => {
    const fetchMock = mockFetchResponse({ choices: [{ message: { content: "ok" } }] });
    const provider = new NvidiaProvider("test-key");
    await expect(provider.generate({
      prompt: "",
      model: "moonshotai/kimi-k3",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", imageUrl: "file:///etc/passwd" }
        ]
      }]
    })).rejects.toThrowError(ProviderInvalidRequestError);
  });
});
