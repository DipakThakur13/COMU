import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Server } from "http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { AgentOrchestrator } from "@comu/agent-core";
import { ToolExecutor, ToolRegistry } from "@comu/tool-core";
import { ComuDiffEngine } from "@comu/diff-engine";
import { ModelProvider, ModelResponse } from "@comu/model-core";
import { loadSession, recordCheckpoint, relativePath } from "@comu/session-store";
import { createRuntimeApp } from "../src/server";
import { ScriptableCampaignModel } from "./scripted_campaign_harness.js";
import { collectTaskEvents } from "./helpers/sse";

/**
 * S1.4: before a turn first changes a file, the file as it was is recorded on the session.
 *
 * Data only: nothing restores from it yet. What is proved here is that the record exists, says the
 * right thing, and is on disk before the change it precedes, which is what makes "restore to before
 * this turn" possible later even for a turn that died half way.
 */

const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

let workspace: string;
let sessionDir: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "comu-checkpoint-ws-"));
  sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-checkpoint-store-"));
  fs.mkdirSync(path.join(workspace, "src"));
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(sessionDir, { recursive: true, force: true });
});

describe("checkpoints", () => {
  it("are on disk before the write they precede", async () => {
    const original = "export const a = 1;\n";
    fs.writeFileSync(path.join(workspace, "src", "a.ts"), original, "utf8");

    // What the session held at the moment each write ran, read from disk by the write itself.
    const seenByWrite: Array<{ path: string; checkpointed: string[] }> = [];
    const registry = new ToolRegistry();
    registry.register({
      name: "read_file",
      description: "read",
      capabilities: ["read"],
      inputSchema: {},
      execute: async (args: any) => {
        const content = fs.readFileSync(path.join(workspace, args.path), "utf8");
        return { content, hash: sha256(content) };
      }
    });
    registry.register({
      name: "write_file",
      description: "write",
      capabilities: ["write"],
      inputSchema: {},
      execute: async (args: any) => {
        const open = loadSession(workspace, { baseDir: sessionDir }).openCheckpoints?.["cp-task"] ?? [];
        seenByWrite.push({ path: args.path, checkpointed: open.map(e => e.path) });
        fs.writeFileSync(path.join(workspace, args.path), args.content, "utf8");
        return { success: true, hash: sha256(args.content) };
      }
    });

    const model = new ScriptableCampaignModel([
      { text: "Editing.", toolCalls: [{ id: "w1", name: "write_file", arguments: { path: "src/a.ts", content: "export const a = 2;\n" } }] },
      { text: "Adding a file.", toolCalls: [{ id: "w2", name: "write_file", arguments: { path: "src/b.ts", content: "export const b = 1;\n" } }] },
      { text: "Done." }
    ]);
    const orchestrator = new AgentOrchestrator(model, registry, new ToolExecutor(registry), new ComuDiffEngine());
    await orchestrator.run({
      taskId: "cp-task",
      workspaceRoot: workspace,
      mode: "AGENT",
      autonomy: "auto",
      systemPrompt: "",
      userPrompt: "change a and add b",
      limits: { maxSteps: 10, maxToolCalls: 20, maxExecutionTimeMs: 15000 },
      checkpoint: entry => recordCheckpoint(workspace, "cp-task", { ...entry, path: relativePath(workspace, entry.path) }, { baseDir: sessionDir }),
      onEvent: () => {}
    });

    expect(seenByWrite).toEqual([
      { path: "src/a.ts", checkpointed: ["src/a.ts"] },
      { path: "src/b.ts", checkpointed: ["src/a.ts", "src/b.ts"] }
    ]);
    const open = loadSession(workspace, { baseDir: sessionDir }).openCheckpoints?.["cp-task"];
    expect(open?.[0]).toMatchObject({ path: "src/a.ts", existed: true, hash: sha256(original) });
    expect(open?.[1]).toMatchObject({ path: "src/b.ts", existed: false });
    expect(open?.[1].hash).toBeUndefined();
  }, 30000);

  it("end up on the turn: every touched file as it was before the turn's first change to it", async () => {
    const original = "export const greeting = 'Hello';\n";
    fs.writeFileSync(path.join(workspace, "src", "greet.ts"), original, "utf8");

    const responses: ModelResponse[] = [
      { text: "Editing.", toolCalls: [{ id: "w1", name: "write_file", arguments: { path: "src/greet.ts", content: "export const greeting = 'Hi';\n" } }] },
      { text: "Adding.", toolCalls: [{ id: "c1", name: "create_file", arguments: { path: "src/new.ts", content: "export {};\n" } }] },
      // A second change to the same file does not move its checkpoint: it is the state before the turn.
      { text: "Again.", toolCalls: [{ id: "w2", name: "write_file", arguments: { path: "src/greet.ts", content: "export const greeting = 'Hey';\n" } }] },
      { text: "Done." }
    ];
    const model: ModelProvider = {
      id: "scripted",
      name: "Scripted",
      getCapabilities: () => ({ toolCalling: true, streaming: false, reasoning: false, vision: false, structuredOutput: true, maxContextTokens: 128000 }),
      generate: async () => responses.shift() ?? { text: "Done." }
    };

    const app = createRuntimeApp({ providerFactory: () => model, sessionStoreDir: sessionDir });
    let server!: Server;
    const baseUrl = await new Promise<string>(resolve => {
      server = app.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as any).port}`));
    });
    try {
      await fetch(`${baseUrl}/v1/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { "scripted-model": { apiKey: "test-only" } } })
      });
      const res = await fetch(`${baseUrl}/v1/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: "scripted-model", prompt: "change the greeting and add a module", mode: "AGENT", autonomy: "auto", workspace: { rootPath: workspace } })
      });
      const { taskId } = (await res.json()) as { taskId: string };
      await collectTaskEvents(baseUrl, taskId, {}, 30000);

      const session = loadSession(workspace, { baseDir: sessionDir });
      const checkpoint = session.turns[0].checkpoint ?? [];
      expect(checkpoint.map(({ capturedAt: _t, ...rest }) => rest)).toEqual([
        { path: "src/greet.ts", existed: true, hash: sha256(original) },
        { path: "src/new.ts", existed: false }
      ]);
      // Moved onto the turn, not left open.
      expect(session.openCheckpoints?.[taskId]).toBeUndefined();
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 60000);
});
