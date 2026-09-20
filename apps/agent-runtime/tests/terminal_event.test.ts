import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Server } from "http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent } from "@comu/protocol";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";
import { createRuntimeApp } from "../src/server";
import { collectTaskEvents } from "./helpers/sse";

/**
 * Every task ends with exactly one terminal event.
 *
 * It used not to. A run that stopped at a step, tool call or repair limit returned `limit_reached`
 * having published only `agent.limit_reached`, and the stream simply closed. Anything waiting for a
 * task.* event waited forever, which in the panel means a task that stays on "running" until the
 * window is reloaded.
 *
 * Emitting the event changes no agent behaviour, costs no tokens and alters no outcome. It only
 * tells the client the task is over.
 */

/** Never stops calling tools, so the run is guaranteed to hit a limit rather than finish. */
class NeverFinishesModel implements ModelProvider {
  id = "never-finishes";
  name = "Never finishes";
  public calls = 0;

  getCapabilities() {
    return { toolCalling: true, streaming: false, reasoning: false, vision: false, structuredOutput: true, maxContextTokens: 8000 };
  }

  async generate(_request: ModelRequest): Promise<ModelResponse> {
    this.calls += 1;
    return {
      text: "Still looking.",
      toolCalls: [{ id: `c${this.calls}`, name: "read_file", arguments: { path: "readme.txt" } }]
    };
  }
}

const TERMINAL = new Set(["task.completed", "task.failed", "task.cancelled"]);

describe("Terminal events", () => {
  let server: Server;
  let baseUrl: string;
  let workspace: string;

  beforeAll(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "comu-terminal-"));
    fs.writeFileSync(path.join(workspace, "readme.txt"), "hello", "utf8");

    const app = createRuntimeApp({ providerFactory: () => new NeverFinishesModel() });
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        resolve();
      });
    });
    await fetch(`${baseUrl}/v1/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { "never-finishes-model": { apiKey: "test-only" } } })
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  async function runToLimit(): Promise<AgentEvent[]> {
    const created = await fetch(`${baseUrl}/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "read the readme forever",
        modelId: "never-finishes-model",
        mode: "AGENT",
        autonomy: "auto",
        workspace: { rootPath: workspace },
        // Small enough that the limit arrives quickly, which is the point of the test.
        limits: { maxSteps: 3, maxToolCalls: 3 }
      })
    });
    expect(created.status).toBe(201);
    const { taskId } = (await created.json()) as { taskId: string };
    return collectTaskEvents(baseUrl, taskId, {}, 60_000);
  }

  it("publishes a terminal event when the run stops at a limit", async () => {
    const events = await runToLimit();
    const terminal = events.filter(e => TERMINAL.has(e.type));
    expect(terminal.length, `saw: ${events.map(e => e.type).join(", ")}`).toBe(1);
  }, 90_000);

  it("says why, with a code a client can act on", async () => {
    const events = await runToLimit();
    const failed = events.find(e => e.type === "task.failed") as unknown as {
      error?: string;
      payload?: { code?: string; message?: string };
    };
    expect(failed).toBeDefined();
    expect(failed.payload?.code).toBe("LIMIT_REACHED");
    expect(failed.error).toMatch(/stopped early/i);
  }, 90_000);

  it("still reports the limit itself, so the reason is not lost", async () => {
    // agent.limit_reached remains: the terminal event tells the client the task is over, and this
    // one says what stopped it.
    const events = await runToLimit();
    expect(events.some(e => e.type === "agent.limit_reached")).toBe(true);
  }, 90_000);

  it("does not add a second terminal event to a task that ended normally", async () => {
    const app = createRuntimeApp({
      providerFactory: () => ({
        id: "quiet",
        name: "Quiet",
        getCapabilities: () => ({
          toolCalling: true,
          streaming: false,
          reasoning: false,
          vision: false,
          structuredOutput: true,
          maxContextTokens: 8000
        }),
        generate: async () => ({ text: "Nothing to do." })
      })
    });
    const quiet = await new Promise<Server>(resolve => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const url = `http://127.0.0.1:${(quiet.address() as { port: number }).port}`;
    try {
      await fetch(`${url}/v1/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { "quiet-model": { apiKey: "test-only" } } })
      });
      const created = await fetch(`${url}/v1/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "say nothing",
          modelId: "quiet-model",
          mode: "CHAT",
          workspace: { rootPath: workspace }
        })
      });
      const { taskId } = (await created.json()) as { taskId: string };
      const events = await collectTaskEvents(url, taskId, {}, 60_000);
      expect(events.filter(e => TERMINAL.has(e.type)).length).toBe(1);
    } finally {
      await new Promise<void>(resolve => quiet.close(() => resolve()));
    }
  }, 90_000);
});
