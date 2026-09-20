import { describe, it, expect, vi } from "vitest";
import { ModelRequestManager, ModelProvider, ModelRequest, ModelResponse, ModelRequestContext, OpenAICompatibleProvider, OLLAMA_CAPABILITY_PROFILE } from "../src/index.js";

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    }
  });
}

function deltaFrame(content?: string, reasoning?: string) {
  const delta: Record<string, string> = {};
  if (content !== undefined) delta.content = content;
  if (reasoning !== undefined) delta.reasoning_content = reasoning;
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;
}

describe("Provider token streaming", () => {
  const originalFetch = globalThis.fetch;

  it("hands every chunk to onDelta as it arrives and still returns the accumulated text", async () => {
    globalThis.fetch = vi.fn(async () => new Response(sseStream([
      deltaFrame(undefined, "thinking about it"),
      deltaFrame("Hello"),
      deltaFrame(", "),
      deltaFrame("world"),
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } })}\n\n`,
      "data: [DONE]\n\n"
    ]), { status: 200 })) as any;

    try {
      const provider = new OpenAICompatibleProvider("k", "http://127.0.0.1:1/v1", "m", OLLAMA_CAPABILITY_PROFILE);
      const seen: Array<{ kind: string; text: string }> = [];
      const ctx = { onDelta: (d: any) => seen.push({ kind: d.kind, text: d.text }) } as ModelRequestContext;
      const res = await provider.generate({ prompt: "hi" } as ModelRequest, ctx);

      expect(seen).toEqual([
        { kind: "reasoning", text: "thinking about it" },
        { kind: "text", text: "Hello" },
        { kind: "text", text: ", " },
        { kind: "text", text: "world" }
      ]);
      // deltas are additive: the complete response is unchanged
      expect(res.text).toBe("Hello, world");
      expect(res.thinking).toBe("thinking about it");
      expect(res.usage?.totalTokens).toBe(13);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("a throwing delta consumer never breaks generation", async () => {
    globalThis.fetch = vi.fn(async () => new Response(sseStream([
      deltaFrame("safe"),
      "data: [DONE]\n\n"
    ]), { status: 200 })) as any;
    try {
      const provider = new OpenAICompatibleProvider("k", "http://127.0.0.1:1/v1", "m", OLLAMA_CAPABILITY_PROFILE);
      const res = await provider.generate({ prompt: "hi" } as ModelRequest, {
        onDelta: () => { throw new Error("consumer exploded"); }
      } as ModelRequestContext);
      expect(res.text).toBe("safe");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

class DeltaModel implements ModelProvider {
  id = "delta";
  name = "Delta";
  constructor(private chunks: Array<{ kind: "text" | "reasoning"; text: string }>, private usage?: any) {}
  getCapabilities() {
    return { toolCalling: true, streaming: true, reasoning: true, vision: false, structuredOutput: true, maxContextTokens: 1000 };
  }
  async generate(_req: ModelRequest, ctx?: ModelRequestContext): Promise<ModelResponse> {
    for (const c of this.chunks) ctx?.onDelta?.(c);
    return { text: this.chunks.filter(c => c.kind === "text").map(c => c.text).join(""), usage: this.usage };
  }
}

describe("ModelRequestManager delta and usage events", () => {
  it("emits monotonic per-kind indices on the main channel and reports usage", async () => {
    const events: any[] = [];
    const model = new DeltaModel(
      [{ kind: "text", text: "a" }, { kind: "reasoning", text: "r1" }, { kind: "text", text: "b" }],
      { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    );
    const manager = new ModelRequestManager(model, e => events.push(e), {
      pricePerMillionTokens: { input: 1, output: 2 }
    });
    await manager.execute("t1", "r1", { prompt: "hi" });

    const deltas = events.filter(e => e.type === "model.token_delta");
    expect(deltas.map(d => [d.kind, d.delta, d.index])).toEqual([
      ["text", "a", 0],
      ["reasoning", "r1", 0],
      ["text", "b", 1]
    ]);
    expect(deltas.every(d => d.channel === "main")).toBe(true);
    expect(deltas.every(d => d.subagentId === undefined)).toBe(true);
    expect(new Set(deltas.map(d => d.requestId)).size).toBe(1);

    const ok = events.find(e => e.type === "model_request.succeeded");
    expect(ok.usage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    expect(ok.costUsd).toBeCloseTo((100 * 1 + 50 * 2) / 1_000_000, 12);
  });

  it("omits cost when the model has no known price, and never reports zero instead", async () => {
    const events: any[] = [];
    const manager = new ModelRequestManager(
      new DeltaModel([{ kind: "text", text: "x" }], { promptTokens: 5, completionTokens: 5, totalTokens: 10 }),
      e => events.push(e)
    );
    await manager.execute("t1", "r1", { prompt: "hi" });
    const ok = events.find(e => e.type === "model_request.succeeded");
    expect(ok.usage.totalTokens).toBe(10);
    expect(ok.costUsd).toBeUndefined();
  });

  it("tags deltas with a subagent channel when configured", async () => {
    const events: any[] = [];
    const manager = new ModelRequestManager(
      new DeltaModel([{ kind: "text", text: "found it" }]),
      e => events.push(e),
      { streamChannel: "subagent", subagentId: "sub-7" }
    );
    await manager.execute("t1", "sub-7", { prompt: "hi" });
    const delta = events.find(e => e.type === "model.token_delta");
    expect(delta.channel).toBe("subagent");
    expect(delta.subagentId).toBe("sub-7");
  });
});
