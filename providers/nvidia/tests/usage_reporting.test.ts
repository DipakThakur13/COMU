import { describe, it, expect, afterEach, vi } from "vitest";
import { NvidiaProvider } from "../src/index";

/**
 * A streamed response must still report tokens.
 *
 * This API returns `usage: null` in every chunk and emits no totals at the end unless the request
 * asks for them. Without the ask, every request came back as zero tokens: the panel's live token
 * and cost display read zero for the provider in use, and nothing could tell a prompt approaching
 * the context window from a small one. The stream parser already handled a usage chunk; only the
 * asking was missing, which is why it went unnoticed.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function captureRequest(streamBody: string): { bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(streamBody, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  return { bodies };
}

const CHUNKS = [
  'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}],"usage":null}',
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":null}',
  'data: {"choices":[],"usage":{"prompt_tokens":393,"completion_tokens":57,"total_tokens":450}}',
  "data: [DONE]"
].join("\n\n");

const request = {
  model: "nvidia/nemotron-3-ultra-550b-a55b",
  prompt: "hello",
  messages: [{ role: "user" as const, content: "hello" }]
};

describe("Streaming usage", () => {
  it("asks the API to include usage", () => {
    const { bodies } = captureRequest(CHUNKS);
    const provider = new NvidiaProvider("test-key", undefined, "nvidia/nemotron-3-ultra-550b-a55b");
    return provider.generate(request as never).then(() => {
      expect(bodies[0].stream).toBe(true);
      expect(bodies[0].stream_options).toEqual({ include_usage: true });
    });
  });

  it("reports the tokens the API sends back, rather than zero", async () => {
    captureRequest(CHUNKS);
    const provider = new NvidiaProvider("test-key", undefined, "nvidia/nemotron-3-ultra-550b-a55b");
    const response = await provider.generate(request as never);
    expect(response.usage).toEqual({ promptTokens: 393, completionTokens: 57, totalTokens: 450 });
  });

  it("still reads the content, with the usage chunk carrying no choices", async () => {
    // The final chunk has an empty choices array. A parser that assumed a delta was always present
    // would throw on it or skip the totals.
    captureRequest(CHUNKS);
    const provider = new NvidiaProvider("test-key", undefined, "nvidia/nemotron-3-ultra-550b-a55b");
    const response = await provider.generate(request as never);
    expect(response.text).toBe("Hello");
  });

  it("does not ask for usage when the request is not streamed", async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "hi", role: "assistant" } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    // A model whose profile does not default to streaming.
    const provider = new NvidiaProvider("test-key", undefined, "nvidia/nemotron-4-340b-instruct");
    await provider.generate({ ...request, model: "nvidia/nemotron-4-340b-instruct", temperature: 0.1 } as never);
    expect(bodies[0].stream).toBeFalsy();
    expect(bodies[0].stream_options).toBeUndefined();
  });
});
