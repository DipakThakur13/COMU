import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Server } from "http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";
import { createRuntimeApp } from "../src/server";
import { collectTaskEvents } from "./helpers/sse";

class QueueModel implements ModelProvider {
  id = "queue";
  name = "Queue";
  public responses: ModelResponse[] = [];
  public requests: ModelRequest[] = [];
  getCapabilities() {
    return { toolCalling: true, streaming: false, reasoning: false, vision: false, structuredOutput: true, maxContextTokens: 8000 };
  }
  async generate(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push(req);
    return this.responses.shift() || { text: "Done." };
  }
}

async function json(baseUrl: string, route: string, method = "GET", body?: unknown) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

async function waitForInteraction(baseUrl: string, taskId: string, attempts = 200) {
  for (let i = 0; i < attempts; i++) {
    const { body } = await json(baseUrl, `/v1/tasks/${taskId}/interactions`);
    if (body.interaction) return body.interaction;
    await new Promise(r => setTimeout(r, 25));
  }
  return null;
}

describe("Approval over HTTP (Phase 1.2)", () => {
  let server: Server;
  let baseUrl: string;
  let fixtureRoot: string;
  const model = new QueueModel();

  beforeAll(async () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "comu-approval-"));
    fs.writeFileSync(path.join(fixtureRoot, "notes.txt"), "original\n", "utf8");
    const app = createRuntimeApp({ providerFactory: () => model, approvalTimeoutMs: 1500, approvalObserverGraceMs: 150 });
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
        resolve();
      });
    });
    await json(baseUrl, "/v1/config", "POST", { config: { "queue-model": { apiKey: "test-only" } } });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  function start(autonomy: string, prompt = "Add a second line to notes.txt") {
    return json(baseUrl, "/v1/tasks", "POST", { prompt, modelId: "queue-model", mode: "AGENT", autonomy, workspace: { rootPath: fixtureRoot } });
  }

  it("rejects an invalid autonomy level", async () => {
    const { status, body } = await start("yolo");
    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_AUTONOMY");
  });

  it("ask: the interaction carries the diff; approving over HTTP resumes and the write lands", async () => {
    model.responses = [
      { text: "Writing.", toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "notes.txt", content: "original\nsecond line\n" } }] },
      { text: "Investigation done." },
      { text: "Implementation done." }
    ];
    const { status, body } = await start("ask");
    expect(status).toBe(201);
    const taskId = body.taskId as string;
    const collecting = collectTaskEvents(baseUrl, taskId, {}, 15000); // a subscriber: a human is watching

    const interaction = await waitForInteraction(baseUrl, taskId);
    expect(interaction, "expected a pending approval").toBeTruthy();
    expect(interaction.type).toBe("APPROVAL");
    expect(interaction.approval.file.path).toBe("notes.txt");
    expect(interaction.approval.file.diff).toContain("+second line");
    expect(fs.readFileSync(path.join(fixtureRoot, "notes.txt"), "utf8")).toBe("original\n");

    // a scope key that was not offered is refused
    const bad = await json(baseUrl, `/v1/tasks/${taskId}/interactions/${interaction.interactionId}/respond`, "POST", { response: { type: "APPROVE_SESSION", scopeKey: "cmd:rm -rf" } });
    expect(bad.status).toBe(400);

    const ok = await json(baseUrl, `/v1/tasks/${taskId}/interactions/${interaction.interactionId}/respond`, "POST", { response: { type: "APPROVE" } });
    expect(ok.status).toBe(200);

    const events = await collecting;
    const terminal = events.find(e => e.type === "task.completed" || e.type === "task.failed") as any;
    expect(terminal?.type, JSON.stringify(terminal)).toBe("task.completed");
    expect(fs.readFileSync(path.join(fixtureRoot, "notes.txt"), "utf8")).toBe("original\nsecond line\n");
    expect(events.some(e => (e as any).status === "WAITING_FOR_USER" || String((e as any).status || "").startsWith("Waiting for approval"))).toBe(true);
    expect((events.find(e => e.type === "approval.decided") as any)?.decision).toBe("APPROVED");
  });

  it("ask: approve-for-session with an offered scope key is accepted and journaled with that key", async () => {
    model.responses = [
      { text: "Writing.", toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "notes.txt", content: "third\n" } }] },
      { text: "Investigation done." },
      { text: "Implementation done." }
    ];
    const { body } = await start("ask");
    const taskId = body.taskId as string;
    const collecting = collectTaskEvents(baseUrl, taskId, {}, 15000);
    const interaction = await waitForInteraction(baseUrl, taskId);
    const scopeKey = interaction.approval.scopes.find((s: any) => s.key === "writes:*").key;
    const ok = await json(baseUrl, `/v1/tasks/${taskId}/interactions/${interaction.interactionId}/respond`, "POST", { response: { type: "APPROVE_SESSION", scopeKey } });
    expect(ok.status).toBe(200);
    const events = await collecting;
    expect((events.find(e => e.type === "approval.decided") as any)).toMatchObject({ decision: "APPROVED_SESSION", scopeKey: "writes:*" });
  });

  it("headless: with no event stream subscriber the write is denied, never blocked", async () => {
    model.responses = [
      { text: "Writing.", toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "headless.txt", content: "should not exist\n" } }] },
      { text: "Nobody is watching; stopping." },
      { text: "Done." }
    ];
    const { body } = await start("ask");
    const taskId = body.taskId as string;

    // Poll interactions only (not an SSE subscriber). No approval must ever appear.
    const interaction = await waitForInteraction(baseUrl, taskId, 20);
    expect(interaction).toBeNull();

    // Subscribing afterwards replays the journal of the finished task.
    const events = await collectTaskEvents(baseUrl, taskId, {}, 10000);
    const decided = events.find(e => e.type === "approval.decided") as any;
    expect(decided?.decision).toBe("NO_HUMAN_OBSERVER");
    expect(fs.existsSync(path.join(fixtureRoot, "headless.txt"))).toBe(false);

    // The point of this test is that the denial does not leave the task hanging, which is now
    // asserted directly: exactly one terminal event, whatever it says. It previously asserted the
    // absence of task.failed, which passed only because the run ended at a limit and published no
    // terminal event at all. That was the hang, being read as a pass.
    const terminals = events.filter(
      e => e.type === "task.completed" || e.type === "task.failed" || e.type === "task.cancelled"
    );
    expect(terminals.map(e => e.type)).toHaveLength(1);
  });

  it("auto: git_push still requires a human; with none attached it is denied and never runs", async () => {
    model.responses = [
      { text: "Pushing.", toolCalls: [{ id: "c1", name: "git_push", arguments: { remote: "origin", branch: "main" } }] },
      { text: "Push was not approved; stopping." },
      { text: "Done." }
    ];
    const { body } = await start("auto", "Add a note and push it");
    const taskId = body.taskId as string;
    expect(await waitForInteraction(baseUrl, taskId, 20)).toBeNull(); // headless: nothing to approve with
    const events = await collectTaskEvents(baseUrl, taskId, {}, 10000);
    const decided = events.find(e => e.type === "approval.decided") as any;
    expect(decided).toMatchObject({ tool: "git_push", kind: "git_push", approved: false, decision: "NO_HUMAN_OBSERVER" });
    const pushResult = events.find(e => e.type === "tool.completed" && (e as any).tool === "git_push") as any;
    expect(pushResult.result.error).toContain("APPROVAL_DENIED");
    expect(events.some(e => e.type === "git.push.completed")).toBe(false);
  });

  it("auto: git_push with a human attached raises a non-grantable approval card", async () => {
    model.responses = [
      { text: "Pushing.", toolCalls: [{ id: "c1", name: "git_push", arguments: { remote: "origin", branch: "main" } }] },
      { text: "Push was denied; stopping." },
      { text: "Done." }
    ];
    const { body } = await start("auto", "Add a note and push it");
    const taskId = body.taskId as string;
    const collecting = collectTaskEvents(baseUrl, taskId, {}, 15000);
    const interaction = await waitForInteraction(baseUrl, taskId);
    expect(interaction, "expected a push approval").toBeTruthy();
    expect(interaction.approval.kind).toBe("git_push");
    expect(interaction.approval.scopes).toEqual([]);
    const ok = await json(baseUrl, `/v1/tasks/${taskId}/interactions/${interaction.interactionId}/respond`, "POST", { response: { type: "DENY" } });
    expect(ok.status).toBe(200);
    const events = await collecting;
    expect((events.find(e => e.type === "approval.decided") as any)?.decision).toBe("DENIED");
  });

  it("auto: no approval is raised and the write lands", async () => {
    model.responses = [
      { text: "Writing.", toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "auto.txt", content: "auto\n" } }] },
      { text: "Investigation done." },
      { text: "Implementation done." }
    ];
    const { body } = await start("auto");
    const events = await collectTaskEvents(baseUrl, body.taskId, {}, 15000);
    expect(events.some(e => e.type === "interaction.requested")).toBe(false);
    expect(fs.readFileSync(path.join(fixtureRoot, "auto.txt"), "utf8")).toBe("auto\n");
  });
});
