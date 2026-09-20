import { describe, it, expect } from "vitest";
import { SubagentManager } from "../src/subagent_manager.js";
import { ToolRegistry, ToolExecutor, ToolContext } from "@comu/tool-core";
import { ModelProvider, ModelRequest, ModelResponse, ModelRequestContext } from "@comu/model-core";

class StreamingWorkerModel implements ModelProvider {
  id = "worker-model";
  name = "Worker";
  public sawSignal: AbortSignal | undefined;
  constructor(private chunks: string[], private onCall?: (ctx?: ModelRequestContext) => void) {}
  getCapabilities() {
    return { toolCalling: true, streaming: true, reasoning: false, vision: false, structuredOutput: true, maxContextTokens: 1000 };
  }
  async generate(_req: ModelRequest, ctx?: ModelRequestContext): Promise<ModelResponse> {
    this.sawSignal = ctx?.signal;
    this.onCall?.(ctx);
    for (const c of this.chunks) ctx?.onDelta?.({ kind: "text", text: c });
    return { text: this.chunks.join("") };
  }
}

const parentContext: ToolContext = {
  taskId: "parent-1",
  workspace: { rootPath: "/repo" },
  limits: {},
  permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "ALLOW" } }
};

describe("Subagent token streaming stays on its own channel", () => {
  it("tags worker deltas with the subagent channel and id, never the main stream", async () => {
    const events: any[] = [];
    const model = new StreamingWorkerModel(["Found ", "auth.ts"]);
    const registry = new ToolRegistry();
    const result = await new SubagentManager().executeSubagent({
      parentTaskId: "parent-1",
      type: "RESEARCH",
      depth: 1,
      goal: "find auth",
      model,
      registry,
      executor: new ToolExecutor(registry),
      toolContext: parentContext,
      onEvent: e => events.push(e)
    });

    expect(result.status).toBe("COMPLETED");
    const deltas = events.filter(e => e.type === "model.token_delta");
    expect(deltas.map(d => d.delta)).toEqual(["Found ", "auth.ts"]);
    expect(deltas.every(d => d.channel === "subagent")).toBe(true);
    expect(deltas.every(d => d.subagentId === result.subagentId)).toBe(true);
    expect(deltas.map(d => d.index)).toEqual([0, 1]);
    // No worker delta may claim the main channel.
    expect(deltas.some(d => d.channel === "main")).toBe(false);
  });

  it("passes the worker's abort signal to the provider and reports cancellation as CANCELLED", async () => {
    const events: any[] = [];
    const controller = new AbortController();
    const model = new StreamingWorkerModel(["x"], () => {
      controller.abort();
      throw new Error("Request cancelled.");
    });
    const registry = new ToolRegistry();
    const result = await new SubagentManager().executeSubagent({
      parentTaskId: "parent-2",
      type: "RESEARCH",
      depth: 1,
      goal: "find auth",
      parentSignal: controller.signal,
      model,
      registry,
      executor: new ToolExecutor(registry),
      toolContext: parentContext,
      onEvent: e => events.push(e)
    });

    expect(model.sawSignal).toBeDefined();
    expect(result.status).toBe("CANCELLED");
    expect(result.summary).toContain("cancelled");
    expect(events.some(e => e.type === "subagent.cancelled")).toBe(true);
  });
});
