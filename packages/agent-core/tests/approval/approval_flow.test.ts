import { describe, it, expect } from "vitest";
import { AgentOrchestrator, OrchestratorContext } from "../../src/orchestrator.js";
import { InteractionManager } from "../../src/interaction_manager.js";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";
import { ToolExecutor, ToolRegistry } from "@comu/tool-core";
import { ComuDiffEngine } from "@comu/diff-engine";
import { InteractionRequest, TaskAutonomy } from "@comu/protocol";

class ScriptedModel implements ModelProvider {
  id = "scripted";
  name = "Scripted";
  public requests: ModelRequest[] = [];
  constructor(public responses: ModelResponse[]) {}
  getCapabilities() {
    return { toolCalling: true, streaming: false, reasoning: false, vision: false, structuredOutput: true, maxContextTokens: 8000 };
  }
  async generate(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push(req);
    return this.responses.shift() || { text: "Done." };
  }
}

function harness(autonomy: TaskAutonomy, responses: ModelResponse[], opts: { hasHumanObserver?: () => boolean; approvalTimeoutMs?: number; maxExecutionTimeMs?: number } = {}) {
  const files = new Map<string, string>([["src/a.ts", "const a = 1;\n"]]);
  const commands: any[] = [];
  const registry = new ToolRegistry();
  registry.register({
    name: "read_file", description: "", capabilities: ["read"], inputSchema: {},
    execute: async (args: any) => {
      if (!files.has(args.path)) throw new Error(`ENOENT: ${args.path}`);
      return { content: files.get(args.path), hash: `h-${files.get(args.path)!.length}`, path: args.path };
    }
  });
  registry.register({
    name: "write_file", description: "", capabilities: ["write"], inputSchema: {},
    execute: async (args: any) => { files.set(args.path, args.content); return { status: "ok" }; }
  });
  registry.register({
    name: "execute_command", description: "", capabilities: ["execute"], inputSchema: {},
    execute: async (args: any) => { commands.push(args); return { exitCode: 0, stdout: "ok" }; }
  });
  for (const v of ["run_tests", "run_typecheck", "run_build", "run_linter"]) {
    registry.register({ name: v, description: v, capabilities: ["execute"], inputSchema: {}, execute: async () => ({ status: "PASS", exitCode: 0, stdout: "ok" }) });
  }
  const interactionManager = new InteractionManager(30_000);
  const model = new ScriptedModel(responses);
  const orchestrator = new AgentOrchestrator(model, registry, new ToolExecutor(registry), new ComuDiffEngine(), { interactionManager });
  const events: any[] = [];
  const controller = new AbortController();
  const ctx: OrchestratorContext = {
    taskId: `t-${autonomy}-${Math.random().toString(36).slice(2, 6)}`,
    workspaceRoot: "/repo",
    mode: "AGENT",
    autonomy,
    systemPrompt: "sys",
    userPrompt: "Add a constant to src/a.ts",
    limits: { maxSteps: 12, maxToolCalls: 12, maxExecutionTimeMs: opts.maxExecutionTimeMs ?? 20_000, approvalTimeoutMs: opts.approvalTimeoutMs, approvalObserverGraceMs: 0 },
    hasHumanObserver: opts.hasHumanObserver,
    abortSignal: controller.signal,
    onEvent: e => events.push(e)
  };
  const promise = orchestrator.run(ctx);
  const waitForInteraction = async (): Promise<InteractionRequest> => {
    for (let i = 0; i < 400; i++) {
      const p = interactionManager.getPendingInteraction(ctx.taskId);
      if (p) return p;
      await new Promise(r => setTimeout(r, 5));
    }
    throw new Error("no interaction appeared");
  };
  return { promise, model, files, commands, events, interactionManager, controller, ctx, waitForInteraction };
}

const writeA = { id: "c1", name: "write_file", arguments: { path: "src/a.ts", content: "const a = 1;\nexport const b = 2;\n" } };
const writeB = { id: "c2", name: "write_file", arguments: { path: "src/b.ts", content: "export const c = 3;\n" } };
const finish = [{ text: "Investigation done." }, { text: "Implementation done." }];

describe("Approval flow in the orchestrator (Phase 1.2)", () => {
  it("ask: pauses at WAITING_FOR_USER before the first write with a diff, approving lands the write", async () => {
    const h = harness("ask", [{ text: "Writing.", toolCalls: [writeA] }, ...finish]);
    const interaction = await h.waitForInteraction();

    expect(interaction.type).toBe("APPROVAL");
    expect(interaction.approval?.kind).toBe("file_write");
    expect(interaction.approval?.file?.path).toBe("src/a.ts");
    expect(interaction.approval?.file?.operation).toBe("MODIFY");
    expect(interaction.approval?.file?.diff).toContain("+export const b = 2;");
    expect(interaction.approval?.scopes.map(s => s.key)).toEqual(["file:src/a.ts", "dir:src/", "writes:*"]);
    expect(h.files.get("src/a.ts")).toBe("const a = 1;\n"); // nothing written yet
    expect(h.events.some(e => e.type === "agent.status" && String(e.status).startsWith("Waiting for approval"))).toBe(true);

    h.interactionManager.resolveInteraction(h.ctx.taskId, interaction.interactionId, { type: "APPROVE" });
    const res = await h.promise;
    expect(res.status, res.error).toBe("completed");
    expect(h.files.get("src/a.ts")).toContain("export const b = 2;");
    expect(h.events.find(e => e.type === "approval.decided")).toMatchObject({ decision: "APPROVED", tool: "write_file", path: "src/a.ts" });
  });

  it("ask: denying returns APPROVAL_DENIED to the model and the task continues", async () => {
    const h = harness("ask", [{ text: "Writing.", toolCalls: [writeA] }, { text: "Understood, I will not modify it." }, { text: "Done." }]);
    const interaction = await h.waitForInteraction();
    h.interactionManager.resolveInteraction(h.ctx.taskId, interaction.interactionId, { type: "DENY" });
    const res = await h.promise;

    expect(res.status).not.toBe("failed");
    expect(h.files.get("src/a.ts")).toBe("const a = 1;\n");
    const toolMsg = (h.model.requests[1].messages || []).find(m => m.role === "tool");
    expect(String(toolMsg?.content)).toContain("APPROVAL_DENIED");
    expect(h.events.some(e => e.type === "change.created")).toBe(false);
    expect(h.events.find(e => e.type === "approval.decided")?.decision).toBe("DENIED");
  });

  it("ask: approve-for-session with a directory scope covers the next file in that directory but not a command", async () => {
    const h = harness("ask", [
      { text: "Writing.", toolCalls: [writeA] },
      { text: "Writing more.", toolCalls: [writeB, { id: "c3", name: "execute_command", arguments: { executable: "npm", args: ["run", "build"] } }] },
      ...finish
    ]);
    const first = await h.waitForInteraction();
    h.interactionManager.resolveInteraction(h.ctx.taskId, first.interactionId, { type: "APPROVE_SESSION", scopeKey: "dir:src/" });

    const second = await h.waitForInteraction(); // must be the command, not src/b.ts
    expect(second.approval?.kind).toBe("command");
    expect(second.approval?.command?.args).toEqual(["run", "build"]);
    expect(h.files.get("src/b.ts")).toBe("export const c = 3;\n"); // written under the directory grant
    h.interactionManager.resolveInteraction(h.ctx.taskId, second.interactionId, { type: "APPROVE" });

    const res = await h.promise;
    expect(res.status, res.error).toBe("completed");
    const decisions = h.events.filter(e => e.type === "approval.decided").map(e => e.decision);
    expect(decisions).toEqual(["APPROVED_SESSION", "SESSION_GRANT", "APPROVED"]);
  });

  it("ask: a command grant covers only the exact command signature", async () => {
    const h = harness("ask", [
      { text: "Build.", toolCalls: [{ id: "c1", name: "execute_command", arguments: { executable: "npm", args: ["run", "build"] } }] },
      { text: "Again and deploy.", toolCalls: [
        { id: "c2", name: "execute_command", arguments: { executable: "npm", args: ["run", "build"] } },
        { id: "c3", name: "execute_command", arguments: { executable: "npm", args: ["run", "deploy"] } }
      ] },
      ...finish
    ]);
    const first = await h.waitForInteraction();
    h.interactionManager.resolveInteraction(h.ctx.taskId, first.interactionId, { type: "APPROVE_SESSION", scopeKey: "cmd:npm run build" });
    const second = await h.waitForInteraction();
    expect(second.approval?.command?.args).toEqual(["run", "deploy"]);
    h.interactionManager.resolveInteraction(h.ctx.taskId, second.interactionId, { type: "DENY" });
    await h.promise;
    expect(h.commands.map(c => c.args.join(" "))).toEqual(["run build", "run build"]);
  });

  it("ask: cancelling while an approval is pending unwinds to cancelled", async () => {
    const h = harness("ask", [{ text: "Writing.", toolCalls: [writeA] }, ...finish]);
    await h.waitForInteraction();
    h.controller.abort();
    h.interactionManager.cancelTaskInteractions(h.ctx.taskId);
    const res = await h.promise;
    expect(res.status).toBe("cancelled");
    expect(h.files.get("src/a.ts")).toBe("const a = 1;\n");
    expect(h.events.some(e => e.type === "task.cancelled")).toBe(true);
    expect(h.interactionManager.getPendingInteraction(h.ctx.taskId)).toBeUndefined();
  });

  it("auto: raises no approvals at all", async () => {
    const h = harness("auto", [{ text: "Writing.", toolCalls: [writeA, { id: "c9", name: "execute_command", arguments: { executable: "npm", args: ["test"] } }] }, ...finish]);
    const res = await h.promise;
    expect(res.status, res.error).toBe("completed");
    expect(h.events.some(e => e.type === "interaction.requested")).toBe(false);
    expect(h.events.some(e => e.type === "approval.decided")).toBe(false);
    expect(h.files.get("src/a.ts")).toContain("export const b = 2;");
    expect(h.commands).toHaveLength(1);
  });

  it("no human observer: the write is denied immediately instead of blocking", async () => {
    const h = harness("ask", [{ text: "Writing.", toolCalls: [writeA] }, { text: "Nobody approved; stopping." }, { text: "Done." }], { hasHumanObserver: () => false });
    const res = await h.promise;
    expect(res.status).not.toBe("failed");
    expect(h.events.some(e => e.type === "interaction.requested")).toBe(false);
    expect(h.events.find(e => e.type === "approval.decided")?.decision).toBe("NO_HUMAN_OBSERVER");
    expect(h.files.get("src/a.ts")).toBe("const a = 1;\n");
    const toolMsg = (h.model.requests[1].messages || []).find(m => m.role === "tool");
    expect(String(toolMsg?.content)).toContain("No one is watching");
  });

  it("bounded wait: an unanswered approval is denied after approvalTimeoutMs", async () => {
    const h = harness("ask", [{ text: "Writing.", toolCalls: [writeA] }, { text: "Timed out; stopping." }, { text: "Done." }], { approvalTimeoutMs: 60 });
    const res = await h.promise;
    expect(res.status).not.toBe("failed");
    expect(h.events.find(e => e.type === "approval.decided")?.decision).toBe("TIMEOUT");
    expect(h.files.get("src/a.ts")).toBe("const a = 1;\n");
  });

  it("waiting for a human does not count against maxExecutionTimeMs", async () => {
    const h = harness("ask", [{ text: "Writing.", toolCalls: [writeA] }, ...finish], { maxExecutionTimeMs: 400 });
    const interaction = await h.waitForInteraction();
    await new Promise(r => setTimeout(r, 700)); // longer than the whole execution budget
    h.interactionManager.resolveInteraction(h.ctx.taskId, interaction.interactionId, { type: "APPROVE" });
    const res = await h.promise;
    expect(res.status, res.error).toBe("completed");
  });

  it("readonly: forces a read-only contract; writes are contract-rejected, no approval is raised", async () => {
    const h = harness("readonly", [{ text: "Writing.", toolCalls: [writeA] }, { text: "Read-only; explaining instead." }, { text: "Done." }]);
    const res = await h.promise;
    expect(res.status).not.toBe("failed");
    expect(h.events.some(e => e.type === "interaction.requested")).toBe(false);
    const offered = (h.model.requests[0].tools || []).map(t => t.name);
    expect(offered).not.toContain("write_file");
    const rejected = h.events.find(e => e.type === "tool.completed" && e.result?.error);
    expect(rejected.result.error).toContain("CONTRACT_REJECTED");
    expect(h.files.get("src/a.ts")).toBe("const a = 1;\n");
  });
});
