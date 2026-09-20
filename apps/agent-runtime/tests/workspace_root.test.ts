import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Server } from "http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";
import { createRuntimeApp, resolveWorkspaceRoot } from "../src/server";
import { collectTaskEvents } from "./helpers/sse";

class ScriptedModel implements ModelProvider {
  id = "scripted";
  name = "Scripted";
  public requests: ModelRequest[] = [];
  constructor(private responses: ModelResponse[]) {}

  getCapabilities() {
    return { toolCalling: true, streaming: false, reasoning: false, vision: false, structuredOutput: true, maxContextTokens: 8000 };
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push(req);
    return this.responses.shift() || { text: "Done." };
  }
}

describe("Runtime task workspace root (Phase 0.1)", () => {
  let server: Server;
  let baseUrl: string;
  let fixtureRoot: string;
  let scripted: ScriptedModel;

  beforeAll(async () => {
    // Fixture repository lives outside the runtime's own cwd so a cwd fallback would be caught.
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "comu-ws-root-"));
    fs.writeFileSync(path.join(fixtureRoot, "hello.txt"), "fixture-content-42", "utf8");
    fs.writeFileSync(path.join(fixtureRoot, "print_cwd.js"), "console.log(process.cwd());", "utf8");

    scripted = new ScriptedModel([
      {
        text: "Inspecting the workspace.",
        toolCalls: [
          { id: "c1", name: "read_file", arguments: { path: "hello.txt" } },
          { id: "c2", name: "write_file", arguments: { path: "notes/created.txt", content: "written by task" } },
          { id: "c3", name: "execute_command", arguments: { executable: "node", args: ["print_cwd.js"] } }
        ]
      },
      { text: "Investigation complete." },
      { text: "Implementation complete." }
    ]);

    const app = createRuntimeApp({ providerFactory: () => scripted });
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("resolveWorkspaceRoot rejects missing, relative and non-existent roots", () => {
    expect(resolveWorkspaceRoot(undefined)).toMatchObject({ ok: false, code: "WORKSPACE_REQUIRED" });
    expect(resolveWorkspaceRoot({})).toMatchObject({ ok: false, code: "WORKSPACE_REQUIRED" });
    expect(resolveWorkspaceRoot({ rootPath: "   " })).toMatchObject({ ok: false, code: "WORKSPACE_REQUIRED" });
    expect(resolveWorkspaceRoot({ rootPath: "relative/dir" })).toMatchObject({ ok: false, code: "WORKSPACE_INVALID" });
    expect(resolveWorkspaceRoot({ rootPath: path.join(fixtureRoot, "does-not-exist") })).toMatchObject({ ok: false, code: "WORKSPACE_INVALID" });
    expect(resolveWorkspaceRoot({ rootPath: path.join(fixtureRoot, "hello.txt") })).toMatchObject({ ok: false, code: "WORKSPACE_INVALID" });

    const ok = resolveWorkspaceRoot({ rootPath: fixtureRoot, workspaceId: "ws-1" });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.rootPath).toBe(fs.realpathSync(fixtureRoot));
      expect(ok.workspaceId).toBe("ws-1");
    }
  });

  it("POST /v1/tasks rejects a task with no workspace instead of using process.cwd()", async () => {
    const res = await fetch(`${baseUrl}/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Add a note", modelId: "ollama-local" })
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe("WORKSPACE_REQUIRED");
  });

  it("POST /v1/tasks rejects a relative workspace root", async () => {
    const res = await fetch(`${baseUrl}/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Add a note", modelId: "ollama-local", workspace: { rootPath: "some/relative/path" } })
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe("WORKSPACE_INVALID");
  });

  it("runs file reads, file writes and commands inside the requested workspace, never the runtime cwd", async () => {
    const runtimeCwd = process.cwd();
    const rel = path.relative(runtimeCwd, fixtureRoot);
    expect(rel.startsWith("..") || path.isAbsolute(rel)).toBe(true);

    const res = await fetch(`${baseUrl}/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Add a note file describing the workspace",
        modelId: "ollama-local",
        workspace: { rootPath: fixtureRoot, workspaceId: "fixture-ws" }
      })
    });
    expect(res.status).toBe(201);
    const { taskId, workspaceRoot } = (await res.json()) as any;
    expect(workspaceRoot).toBe(fs.realpathSync(fixtureRoot));

    const events = await collectTaskEvents(baseUrl, taskId);
    const terminal = events.find(e => e.type === "task.completed" || e.type === "task.failed");
    expect(terminal?.type, JSON.stringify(terminal)).toBe("task.completed");

    const toolResults = events.filter(e => e.type === "tool.completed") as any[];

    // read_file resolved against the fixture, not the runtime cwd
    const read = toolResults.find(e => e.tool === "read_file");
    expect(read?.result?.content).toBe("fixture-content-42");

    // write_file landed under the fixture and nowhere near process.cwd()
    const writtenInFixture = path.join(fixtureRoot, "notes", "created.txt");
    expect(fs.existsSync(writtenInFixture)).toBe(true);
    expect(fs.readFileSync(writtenInFixture, "utf8")).toBe("written by task");
    expect(fs.existsSync(path.join(runtimeCwd, "notes", "created.txt"))).toBe(false);

    // execute_command ran with the fixture as its working directory
    const cmd = toolResults.find(e => e.tool === "execute_command");
    expect(cmd?.result?.exitCode).toBe(0);
    expect(fs.realpathSync(cmd.result.stdout.trim())).toBe(fs.realpathSync(fixtureRoot));
    expect(fs.realpathSync(cmd.result.cwd)).toBe(fs.realpathSync(fixtureRoot));
  });
});
