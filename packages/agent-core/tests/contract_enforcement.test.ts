import { describe, it, expect, vi } from "vitest";
import { AgentOrchestrator, OrchestratorContext } from "../src/orchestrator.js";
import { SubagentManager } from "../src/subagent_manager.js";
import { permissionsFromContract, toolAllowedByContract } from "../src/interaction/task_contract.js";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";
import { ToolExecutor, ToolRegistry, ToolContext } from "@comu/tool-core";
import { ComuDiffEngine } from "@comu/diff-engine";

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

function buildRegistry() {
  const calls: Record<string, any[]> = { read_file: [], write_file: [], execute_command: [], web_docs: [] };
  const seenPermissions: Record<string, any> = {};
  const registry = new ToolRegistry();
  registry.register({
    name: "read_file", description: "read", capabilities: ["read"], inputSchema: { type: "object" },
    execute: async (args: any, ctx: ToolContext) => { calls.read_file.push(args); seenPermissions.read_file = ctx.permissions; return { content: "const a = 1;", hash: "h1", path: args.path }; }
  });
  registry.register({
    name: "write_file", description: "write", capabilities: ["write"], inputSchema: { type: "object" },
    execute: async (args: any) => { calls.write_file.push(args); return { status: "ok", hash: "h2" }; }
  });
  registry.register({
    name: "execute_command", description: "exec", capabilities: ["execute"], inputSchema: { type: "object" },
    execute: async (args: any) => { calls.execute_command.push(args); return { exitCode: 0, stdout: "" }; }
  });
  registry.register({
    name: "web_docs", description: "docs", capabilities: ["network"], inputSchema: { type: "object" },
    execute: async (args: any) => { calls.web_docs.push(args); return { content: "docs" }; }
  });
  for (const v of ["run_tests", "run_typecheck", "run_build", "run_linter"]) {
    registry.register({
      name: v, description: v, capabilities: ["execute"], inputSchema: {},
      execute: async () => ({ status: "PASS", exitCode: 0, stdout: "ok" })
    });
  }
  return { registry, calls, seenPermissions };
}

function run(mode: "ASK" | "AGENT" | "PLAN", prompt: string, responses: ModelResponse[]) {
  const { registry, calls, seenPermissions } = buildRegistry();
  const model = new ScriptedModel(responses);
  const orchestrator = new AgentOrchestrator(model, registry, new ToolExecutor(registry), new ComuDiffEngine());
  const events: any[] = [];
  const ctx: OrchestratorContext = {
    taskId: `t-${mode}`,
    workspaceRoot: "/repo",
    mode,
    autonomy: "auto", // contract enforcement is independent of the approval gate
    systemPrompt: "sys",
    userPrompt: prompt,
    limits: { maxSteps: 10, maxToolCalls: 10, maxExecutionTimeMs: 10000 },
    onEvent: e => events.push(e)
  };
  return { promise: orchestrator.run(ctx), model, calls, seenPermissions, events };
}

describe("Task contract enforcement (Phase 1.1)", () => {
  it("permissionsFromContract denies every capability the contract does not grant", () => {
    expect(permissionsFromContract({ allowedCapabilities: ["read", "network"] })).toEqual({
      capabilities: { read: "ALLOW", write: "DENY", execute: "DENY", network: "ALLOW" }
    });
    expect(toolAllowedByContract({ allowedCapabilities: ["read"], allowedTools: [] }, { name: "write_file", capabilities: ["write"] })).toBe(false);
    expect(toolAllowedByContract({ allowedCapabilities: ["read"], allowedTools: [] }, { name: "read_file", capabilities: ["read"] })).toBe(true);
    expect(toolAllowedByContract({ allowedCapabilities: ["read"], allowedTools: ["search_text"] }, { name: "read_file", capabilities: ["read"] })).toBe(false);
  });

  it("an ASK task is offered no mutating or command tools", async () => {
    const { promise, model } = run("ASK", "Explain the login flow", [{ text: "The login flow starts in auth.ts." }]);
    const res = await promise;
    expect(res.status).toBe("completed");
    const offered = (model.requests[0].tools || []).map(t => t.name);
    expect(offered).toContain("read_file");
    expect(offered).toContain("web_docs");
    expect(offered).toContain("delegate_subtask");
    expect(offered).not.toContain("write_file");
    expect(offered).not.toContain("execute_command");
    expect(offered).not.toContain("run_tests");
  });

  it("an ASK task that attempts write_file is rejected by the contract and continues", async () => {
    const { promise, model, calls, events } = run("ASK", "Explain the login flow", [
      { text: "Let me fix that while I am here.", toolCalls: [
        { id: "c1", name: "write_file", arguments: { path: "src/auth.ts", content: "hacked" } },
        { id: "c2", name: "execute_command", arguments: { executable: "npm", args: ["test"] } }
      ] },
      { text: "Understood, read-only. The login flow starts in auth.ts." }
    ]);
    const res = await promise;

    expect(res.status).toBe("completed");
    expect(res.finalText).toContain("read-only");
    expect(calls.write_file).toEqual([]);
    expect(calls.execute_command).toEqual([]);

    const rejected = events.filter(e => e.type === "tool.completed" && e.result?.error);
    expect(rejected.map(e => e.tool)).toEqual(["write_file", "execute_command"]);
    expect(rejected[0].result.error).toContain("CONTRACT_REJECTED");
    expect(rejected[0].result.error).toMatch(/forbidden in ASK mode/);

    // the model was told, so it can adapt
    const toolMessages = (model.requests[1].messages || []).filter(m => m.role === "tool");
    expect(toolMessages).toHaveLength(2);
    expect(String(toolMessages[0].content)).toContain("CONTRACT_REJECTED");
    expect(events.some(e => e.type === "change.created")).toBe(false);
    expect(events.some(e => e.type === "task.failed")).toBe(false);
  });

  it("an AGENT task is unaffected: mutating tools are offered and execute", async () => {
    const { promise, model, calls, events } = run("AGENT", "Add a helper to src/util.ts", [
      { text: "Writing.", toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "src/util.ts", content: "export const x = 1;" } }] },
      { text: "Investigation done." },
      { text: "Implementation done." }
    ]);
    const res = await promise;
    expect(res.status, res.error).toBe("completed");
    const offered = (model.requests[0].tools || []).map(t => t.name);
    expect(offered).toEqual(expect.arrayContaining(["read_file", "write_file", "execute_command", "web_docs", "delegate_subtask"]));
    expect(calls.write_file).toHaveLength(1);
    expect(events.some(e => e.type === "change.created" && e.path === "src/util.ts")).toBe(true);
    expect(events.some(e => e.type === "agent.status" && e.status === "Executing tools...")).toBe(true);
  });

  it("a PLAN task is offered no tools and never enters TOOL_CALLING even if the model calls one", async () => {
    const { promise, model, calls, events } = run("PLAN", "Plan the migration to ESM", [
      { text: "Reading first.", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "package.json" } }] },
      { text: "Step one complete." },
      { text: "Plan: 1) ... 2) ..." }
    ]);
    const res = await promise;
    expect(["completed", "failed", "limit_reached"]).toContain(res.status);
    expect(model.requests[0].tools).toEqual([]);
    expect(calls.read_file).toEqual([]);
    expect(events.some(e => e.type === "agent.status" && e.status === "Executing tools...")).toBe(false);
    const errored = events.find(e => e.type === "tool.completed" && e.result?.error);
    expect(errored.result.error).toContain("TOOLS_UNAVAILABLE");
    const toolMessages = (model.requests[1].messages || []).filter(m => m.role === "tool");
    expect(String(toolMessages[0].content)).toContain("PLAN mode");
  });

  it("delegate_subtask is gated by the contract: VERIFICATION workers are refused in ASK, RESEARCH allowed", async () => {
    const { promise, events } = run("ASK", "Explain the login flow", [
      { text: "Delegating.", toolCalls: [
        { id: "c1", name: "delegate_subtask", arguments: { type: "VERIFICATION", goal: "run the tests" } },
        { id: "c2", name: "delegate_subtask", arguments: { type: "RESEARCH", goal: "find auth.ts" } }
      ] },
      { text: "The login flow starts in auth.ts." }
    ]);
    const res = await promise;
    expect(res.status).toBe("completed");
    const completed = events.filter(e => e.type === "tool.completed" && e.tool === "delegate_subtask");
    expect(completed[0].result?.error).toContain("CONTRACT_REJECTED");
    expect(completed[1].result?.error).toBeUndefined();
    const started = events.filter(e => e.type === "subagent.started");
    expect(started.length).toBeGreaterThan(0);
    expect(started.every(e => e.subagentType === "RESEARCH")).toBe(true);
  });

  it("a worker's tools run with the parent's permissions intersected with the worker's declaration", async () => {
    const { registry, seenPermissions } = buildRegistry();
    const model = new ScriptedModel([
      { text: "reading", toolCalls: [{ id: "w1", name: "read_file", arguments: { path: "auth.ts" } }] },
      { text: "found it" }
    ]);
    const manager = new SubagentManager();
    const result = await manager.executeSubagent({
      parentTaskId: "p1",
      type: "RESEARCH",
      depth: 1,
      goal: "find auth.ts",
      model,
      registry,
      executor: new ToolExecutor(registry),
      toolContext: {
        taskId: "p1",
        workspace: { rootPath: "/repo" },
        limits: {},
        permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "DENY" } }
      },
      onEvent: () => {}
    });
    expect(result.status).toBe("COMPLETED");
    expect(seenPermissions.read_file).toEqual({
      capabilities: { read: "ALLOW", write: "DENY", execute: "DENY", network: "DENY" }
    });
    const ctx = SubagentManager.buildWorkerToolContext(
      { taskId: "p", workspace: { rootPath: "/" }, limits: {}, permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "ALLOW" } } },
      "VERIFICATION"
    );
    expect(ctx.permissions).toEqual({ capabilities: { read: "ALLOW", write: "DENY", execute: "ALLOW", network: "DENY" } });
  });
});
