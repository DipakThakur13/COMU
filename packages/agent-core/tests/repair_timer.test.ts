import { describe, it, expect, afterEach, vi } from "vitest";
import { AgentOrchestrator, OrchestratorContext } from "../src/orchestrator.js";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";
import { ToolExecutor, ToolRegistry } from "@comu/tool-core";
import { ComuDiffEngine } from "@comu/diff-engine";

/**
 * The repair budget measures time spent repairing, not the age of the task.
 *
 * It used to receive the task's start time, so any task older than maxRepairTimeMs (180 s) was
 * refused every repair with REPAIR_TIMEOUT and 0 attempts. In B0 that was the largest failure class.
 */

const MINUTE = 60_000;

/** A model whose turns can move the (faked) clock, standing in for slow real work. */
class ScriptedModel implements ModelProvider {
  id = "scripted";
  name = "Scripted";
  constructor(private turns: Array<{ response: ModelResponse; advanceMs?: number }>) {}
  getCapabilities() {
    return { toolCalling: true, streaming: false, reasoning: false, vision: false, structuredOutput: true, maxContextTokens: 100_000 };
  }
  async generate(_req: ModelRequest): Promise<ModelResponse> {
    const turn = this.turns.shift();
    if (!turn) return { text: "Done." };
    if (turn.advanceMs) vi.setSystemTime(Date.now() + turn.advanceMs);
    return turn.response;
  }
}

const write = (id: string, content: string): ModelResponse => ({
  text: "",
  toolCalls: [{ id, name: "write_file", arguments: { path: "src/calc.ts", content } }]
});

/** Tests fail until the source contains the repaired line, whatever order the checks run in. */
function registry(state: { source: string }) {
  const r = new ToolRegistry();
  r.register({
    name: "write_file",
    description: "write",
    capabilities: ["write"],
    inputSchema: {},
    execute: async (args: any) => {
      state.source = args.content;
      return { status: "ok" };
    }
  });
  r.register({
    name: "read_file",
    description: "read",
    capabilities: ["read"],
    inputSchema: {},
    execute: async () => ({ content: state.source, hash: `h-${state.source.length}` })
  });
  r.register({
    name: "run_typecheck",
    description: "typecheck",
    capabilities: ["execute"],
    inputSchema: {},
    execute: async () => ({ status: "PASS", exitCode: 0, stdout: "ok" })
  });
  r.register({
    name: "run_tests",
    description: "tests",
    capabilities: ["execute"],
    inputSchema: {},
    execute: async () =>
      state.source.includes("repaired")
        ? { status: "PASS", exitCode: 0, stdout: "1 passed" }
        : { status: "FAIL", exitCode: 1, stdout: "", stderr: "AssertionError: add(2, 2) returned 5 in src/calc.ts" }
  });
  return r;
}

function run(model: ModelProvider, state: { source: string }) {
  const reg = registry(state);
  const orchestrator = new AgentOrchestrator(model, reg, new ToolExecutor(reg), new ComuDiffEngine());
  const events: any[] = [];
  const ctx: OrchestratorContext = {
    taskId: `repair-timer-${Math.random().toString(36).slice(2)}`,
    workspaceRoot: "/fake",
    autonomy: "auto",
    systemPrompt: "sys",
    userPrompt: "Implement an add function in src/calc.ts",
    // A long budget, as B0 ran with: the task may take 25 minutes; repair may take 3.
    limits: { maxSteps: 40, maxToolCalls: 40, maxExecutionTimeMs: 25 * MINUTE, maxRepairTimeMs: 180_000, maxRepairAttempts: 3 },
    onEvent: e => events.push(e)
  };
  return orchestrator.run(ctx).then(result => ({ result, events }));
}

describe("the repair budget", () => {
  afterEach(() => vi.useRealTimers());

  it("still grants a repair to a task that spent twenty minutes implementing before verification failed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const state = { source: "" };
    const model = new ScriptedModel([
      { response: { text: "Read the module; add() belongs in src/calc.ts." } },
      { response: write("w1", "export const add = (a: number, b: number) => a + b + 1;"), advanceMs: 20 * MINUTE },
      { response: { text: "Implemented add()." } },
      // Repair: fix the off-by-one the failing test names.
      { response: write("w2", "export const add = (a: number, b: number) => a + b; // repaired") },
      { response: { text: "Fixed the off-by-one." } }
    ]);

    const { result, events } = await run(model, state);

    expect(events.some(e => e.type === "diagnosis.created")).toBe(true);
    expect(result.error ?? "").not.toMatch(/REPAIR_TIMEOUT/);
    // A granted repair mutates the plan; that event is the product's own record of the attempt.
    expect(events.some(e => e.type === "plan.updated" && /^Remediating failure/.test(e.mutationReason ?? ""))).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("still ends a repair loop that runs past the repair budget", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const state = { source: "" };
    const model = new ScriptedModel([
      { response: { text: "Read the module." } },
      { response: write("w1", "export const add = (a: number, b: number) => a + b + 1;") },
      { response: { text: "Implemented add()." } },
      // The repair itself takes longer than the whole repair budget, and does not fix anything.
      { response: write("w2", "export const add = (a: number, b: number) => a + b + 2;"), advanceMs: 200_000 },
      { response: { text: "Tried again." } },
      { response: write("w3", "export const add = (a: number, b: number) => a + b + 3;") },
      { response: { text: "Tried once more." } }
    ]);

    const { result } = await run(model, state);

    expect(result.status).not.toBe("completed");
    expect(result.error ?? "").toMatch(/REPAIR_TIMEOUT/);
  });
});
