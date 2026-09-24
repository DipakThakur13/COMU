import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Server } from "http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ModelMessage, ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";
import { loadSession } from "@comu/session-store";
import { createRuntimeApp } from "../src/server";
import { collectTaskEvents } from "./helpers/sse";

/**
 * Stage 1 acceptance: a session carries one turn into the next, so COMU can be asked to revise what
 * it just did.
 *
 * Every prompt used to be a cold start: a fresh message array holding the prompt alone. None of
 * these could pass. The model here is scripted, so these prove the plumbing: that the second turn is
 * built from the first turn's answer, changes and routing. Whether it feels right is checked by hand
 * in the extension.
 */

/**
 * Answers from a queue and keeps a copy of every request, taken when it was made.
 *
 * Once a turn's script runs out, the last scripted text answer repeats: each plan step asks the
 * model again, and a model asked again for its report gives the same report.
 */
class RecordingModel implements ModelProvider {
  id = "scripted";
  name = "Scripted";
  public requests: Array<{ systemPrompt?: string; messages: ModelMessage[] }> = [];
  private queue: ModelResponse[] = [];
  private lastText: ModelResponse = { text: "Nothing further." };

  script(...responses: ModelResponse[]): void {
    this.queue = [...responses];
    const lastText = [...responses].reverse().find(r => !r.toolCalls?.length);
    if (lastText) this.lastText = lastText;
  }

  getCapabilities() {
    return { toolCalling: true, streaming: false, reasoning: false, vision: false, structuredOutput: true, maxContextTokens: 128000 };
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    // Copied now: the orchestrator reuses one messages array for every step of a task.
    this.requests.push({ systemPrompt: req.systemPrompt, messages: structuredClone(req.messages ?? []) });
    return this.queue.shift() ?? this.lastText;
  }
}

describe("Stage 1: revising what the previous turn did", () => {
  let workspace: string;
  let sessionDir: string;
  let server: Server | undefined;
  let baseUrl: string;
  let model: RecordingModel;

  async function startRuntime(): Promise<void> {
    const app = createRuntimeApp({ providerFactory: () => model, sessionStoreDir: sessionDir });
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server!.address() as any).port}`;
        resolve();
      });
    });
    await fetch(`${baseUrl}/v1/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { "scripted-model": { apiKey: "test-only" } } })
    });
  }

  async function stopRuntime(): Promise<void> {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
  }

  /** One turn: the requests the model received during it, and the events the task published. */
  async function turn(prompt: string, mode = "AUTO") {
    const before = model.requests.length;
    const res = await fetch(`${baseUrl}/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "scripted-model", prompt, mode, autonomy: "auto", workspace: { rootPath: workspace } })
    });
    expect(res.status).toBe(201);
    const { taskId } = (await res.json()) as { taskId: string };
    const events = await collectTaskEvents(baseUrl, taskId, {}, 30000);
    const mode_ = (events.find(e => e.type === "task.mode_resolved") as any)?.mode;
    const terminal = events.find(e => e.type === "task.completed" || e.type === "task.failed" || e.type === "task.cancelled") as any;
    return { taskId, events, mode: mode_, terminal, requests: model.requests.slice(before) };
  }

  const said = (messages: ModelMessage[], role: string) =>
    messages.filter(m => m.role === role).map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));

  beforeEach(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "comu-session-ws-"));
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-session-store-"));
    fs.writeFileSync(path.join(workspace, "README.md"), "# fixture\n", "utf8");
    model = new RecordingModel();
    await startRuntime();
  });

  afterEach(async () => {
    await stopRuntime();
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  });

  it("revises the snippet it just gave, touching no file", async () => {
    model.script({ text: 'Here is a button:\n\n```html\n<button class="buy">Buy now</button>\n```' });
    const first = await turn("give me an HTML snippet for a buy button");
    expect(first.terminal?.type).toBe("task.completed");

    model.script({ text: 'With inline CSS:\n\n```html\n<button class="buy" style="background:#0a7;color:#fff">Buy now</button>\n```' });
    const second = await turn("add inline CSS to it");

    // A revision of a text answer stays a text answer: it is not routed to AGENT for the verb "add".
    expect(second.mode).toBe(first.mode);
    expect(second.terminal?.type).toBe("task.completed");
    expect(second.terminal?.finalText).toContain('style="background:#0a7;color:#fff"');

    // The second turn is built on what the model actually said in the first, as real messages.
    const request = second.requests[0];
    expect(said(request.messages, "user")[0]).toContain("give me an HTML snippet for a buy button");
    expect(said(request.messages, "assistant").join("\n")).toContain('<button class="buy">Buy now</button>');
    expect(said(request.messages, "user").at(-1)).toContain("add inline CSS to it");

    // One answer, not an investigate, implement and validate plan run inside a read-only task.
    expect(second.requests).toHaveLength(1);
    expect(second.events.some(e => e.type === "change.created")).toBe(false);
    expect(fs.readdirSync(workspace)).toEqual(["README.md"]);
  }, 60000);

  it("undoes the edit the previous turn made, from the session's change set", async () => {
    const file = path.join(workspace, "src", "greet.ts");
    fs.mkdirSync(path.dirname(file));
    const original = 'export const greeting = "Hello";\n';
    const edited = 'export const greeting = "Hi there";\n';
    fs.writeFileSync(file, original, "utf8");

    model.script(
      { text: "Changing the greeting.", toolCalls: [{ id: "w1", name: "write_file", arguments: { path: "src/greet.ts", content: edited } }] },
      { text: "Changed the greeting in src/greet.ts." }
    );
    await turn("change the greeting in src/greet.ts to Hi there", "AGENT");
    expect(fs.readFileSync(file, "utf8")).toBe(edited);

    model.script(
      { text: "Reverting.", toolCalls: [{ id: "w2", name: "write_file", arguments: { path: "src/greet.ts", content: original } }] },
      { text: "Reverted src/greet.ts." }
    );
    const undo = await turn("undo that");

    expect(undo.mode).toBe("AGENT");
    // What to revert comes from the session: the file, and the change the last turn made to it.
    const system = undo.requests[0].systemPrompt ?? "";
    expect(system).toContain("src/greet.ts");
    expect(system).toContain('-export const greeting = "Hello";');
    expect(system).toContain('+export const greeting = "Hi there";');
    expect(fs.readFileSync(file, "utf8")).toBe(original);

    const session = loadSession(workspace, { baseDir: sessionDir });
    expect(session.turns).toHaveLength(2);
    expect(Object.keys(session.changeSet)).toEqual(["src/greet.ts"]);
  }, 60000);

  it("knows which symbol the previous turn renamed when asked to update the other call sites", async () => {
    fs.mkdirSync(path.join(workspace, "src"));
    fs.writeFileSync(path.join(workspace, "src", "price.ts"), "export function calcTotal(xs: number[]) {\n  return xs.reduce((a, b) => a + b, 0);\n}\n", "utf8");
    fs.writeFileSync(path.join(workspace, "src", "cart.ts"), 'import { calcTotal } from "./price";\nexport const total = calcTotal([1, 2]);\n', "utf8");

    model.script(
      {
        text: "Renaming.",
        toolCalls: [{ id: "e1", name: "edit_file", arguments: { path: "src/price.ts", edits: [{ oldText: "calcTotal", newText: "computeTotal" }] } }]
      },
      { text: "Renamed calcTotal to computeTotal in src/price.ts." }
    );
    await turn("rename calcTotal to computeTotal in src/price.ts", "AGENT");

    model.script({ text: "Updating src/cart.ts." });
    const followUp = await turn("also update the other call sites");

    expect(followUp.mode).toBe("AGENT");
    const system = followUp.requests[0].systemPrompt ?? "";
    // Told what the first turn changed without being told again.
    expect(system).toContain("src/price.ts");
    expect(system).toContain("-export function calcTotal(xs: number[]) {");
    expect(system).toContain("+export function computeTotal(xs: number[]) {");
    expect(said(followUp.requests[0].messages, "assistant").join("\n")).toContain("Renamed calcTotal to computeTotal");
  }, 60000);

  it("keeps the thread across a runtime restart", async () => {
    model.script({ text: "```html\n<p>Hello</p>\n```" });
    await turn("give me an HTML paragraph that says hello");

    await stopRuntime();
    await startRuntime();

    model.script({ text: '```html\n<p style="color:red">Hello</p>\n```' });
    const after = await turn("make it red with inline CSS");
    expect(said(after.requests[0].messages, "assistant").join("\n")).toContain("<p>Hello</p>");
    expect(loadSession(workspace, { baseDir: sessionDir }).turns).toHaveLength(2);
  }, 60000);
});
