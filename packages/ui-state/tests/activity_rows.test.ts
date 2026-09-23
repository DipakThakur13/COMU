import { describe, it, expect } from "vitest";
import { ActivityEntry, createInitialSessionState, isActivityGroup, reduceEvent } from "../src/index.js";

/**
 * The stream reports the agent's work, not the orchestrator's internal state.
 *
 * Every test here stands for a row that used to exist and should not, or for a row that carries
 * what a person actually wanted to know. They are the contract for the second pass over the
 * normalised events: state transitions fold away, one action is one row, and the exception is
 * elevated above the routine.
 */

let counter = 0;
function ev(type: string, extra: Record<string, unknown> = {}): any {
  counter += 1;
  return { type, eventId: `e${counter}`, taskId: "t1", timestamp: "2026-09-20T10:00:00.000Z", ...extra };
}

function reduceAll(events: any[], initial = createInitialSessionState()) {
  return events.reduce((s, e) => reduceEvent(s, e), initial);
}

function titles(entries: ActivityEntry[]): string[] {
  return entries.map(e => e.title);
}

describe("the loop's state is not history", () => {
  it("gives no row to any state transition, start or limit", () => {
    const state = reduceAll([
      ev("task.started"),
      ev("task.mode_resolved", { mode: "AGENT", source: "model", confidence: 0.8 }),
      ev("agent.status", { status: "Classifying request", state: "CLASSIFYING" }),
      ev("agent.status", { status: "Thinking...", state: "THINKING" }),
      ev("agent.status", { status: "Executing tools...", state: "TOOL_CALLING" }),
      ev("tool.started", { tool: "list_directory", target: "src" }),
      ev("agent.status", { status: "Observing results", state: "OBSERVING" }),
      ev("verification.started", { verificationId: "v1" }),
      ev("repair.started", { repairAttemptId: "r1", attemptNumber: 1 }),
      ev("plan.step.started", { stepId: "s1" }),
      ev("plan.step.completed", { stepId: "s1" }),
      ev("memory.retrieved", { count: 2 }),
      ev("agent.limit_reached", { limit: "maxExecutionTimeMs" })
    ]);
    expect(state.activity).toEqual([]);
  });

  it("never lets an internal category or a repeated tool name reach a row", () => {
    const state = reduceAll([
      ev("tool.started", { tool: "list_directory", target: "src" }),
      ev("tool.completed", { tool: "list_directory", target: "src", result: [{ name: "a.ts" }, { name: "b.ts" }] })
    ]);
    const text = JSON.stringify(titles(state.activity));
    expect(text).not.toContain("Generic");
    expect(text).not.toContain("list_directory");
    expect(state.activity).toHaveLength(1);
  });

  it("puts what is happening now in the live line, and takes it away when the task ends", () => {
    let state = reduceAll([
      ev("task.started"),
      ev("agent.status", { status: "Executing tools...", state: "TOOL_CALLING" })
    ]);
    expect(state.live?.label).toBe("Working");
    expect(state.agentState).toBe("TOOL_CALLING");

    state = reduceEvent(state, ev("tool.started", { tool: "read_file", target: "src/pagination.ts" }));
    expect(state.live?.label).toBe("Reading src/pagination.ts");

    state = reduceEvent(state, ev("task.completed", { finalText: "done" }));
    expect(state.live).toBeUndefined();
  });

  it("reads the state from the event rather than from the wording of its message", () => {
    // The runtime's messages are written for a log and change freely; the state does not.
    const state = reduceAll([ev("agent.status", { status: "Generating structured engineering plan", state: "PLANNING" })]);
    expect(state.agentState).toBe("PLANNING");
    expect(state.live?.label).toBe("Planning");
  });
});

describe("one action, one row", () => {
  it("pairs a tool's start with its completion", () => {
    const state = reduceAll([
      ev("tool.started", { tool: "read_file", target: "src/auth/login.ts", toolCallId: "c1" }),
      ev("tool.completed", { tool: "read_file", target: "src/auth/login.ts", toolCallId: "c1", result: { path: "src/auth/login.ts", lineCount: 120 } })
    ]);
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].title).toBe("Read login.ts");
    expect((state.activity[0] as any).metric).toBe("120 lines");
    expect(state.activity[0].level).toBe("routine");
  });

  it("reports a write once, as the change it produced", () => {
    const state = reduceAll([
      ev("tool.started", { tool: "write_file", target: "src/auth/login.ts" }),
      ev("tool.completed", { tool: "write_file", target: "src/auth/login.ts", result: { success: true } }),
      ev("change.created", { path: "src/auth/login.ts", operation: "MODIFY", additions: 12, deletions: 3 })
    ]);
    expect(titles(state.activity)).toEqual(["Edited login.ts"]);
    expect((state.activity[0] as any).metric).toBe("+12 −3");
    expect(state.activity[0].level).toBe("substance");
  });

  it("keeps a failed write, because no change followed it", () => {
    const state = reduceAll([
      ev("tool.completed", { tool: "write_file", target: "src/locked.ts", result: { error: "EACCES: permission denied" } })
    ]);
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].title).toBe("Could not edit src/locked.ts");
    expect(state.activity[0].shortDescription).toBe("EACCES: permission denied");
    expect(state.activity[0].status).toBe("failed");
  });

  it("updates a worker's row in place rather than adding a second one", () => {
    const state = reduceAll([
      ev("subagent.started", { subagentId: "sub-1", subagentType: "research", goal: "Find every call site" }),
      ev("subagent.completed", { subagentId: "sub-1", subagentType: "research", result: { summary: "Three call sites" } })
    ]);
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].title).toBe("Research worker");
    expect(state.activity[0].status).toBe("completed");
  });
});

describe("rows say what happened", () => {
  it("names the query and counts the matches on a search", () => {
    const state = reduceAll([
      ev("tool.completed", {
        tool: "search_text",
        target: "fetchRecord",
        result: { matches: [{ path: "a.ts", line: 3 }, { path: "a.ts", line: 9 }, { path: "b.ts", line: 1 }] }
      })
    ]);
    expect(state.activity[0].title).toBe('Searched "fetchRecord"');
    expect((state.activity[0] as any).metric).toBe("3 matches in 2 files");
  });

  it("counts what a directory listing found", () => {
    const state = reduceAll([
      ev("tool.completed", { tool: "list_directory", target: "src/auth", result: [{ name: "login.ts" }, { name: "rate_limit.ts" }] })
    ]);
    expect(state.activity[0].title).toBe("Explored src/auth");
    expect((state.activity[0] as any).metric).toBe("2 entries");
  });

  it("shows a command by its command line, and its exit code only when it failed", () => {
    const state = reduceAll([
      ev("tool.completed", {
        tool: "execute_command",
        target: "npm test",
        result: { executable: "npm", args: ["test"], exitCode: 1, stdout: "2 failing", stderr: "", durationMs: 4000 }
      }),
      ev("tool.completed", {
        tool: "execute_command",
        target: "npm run build",
        result: { executable: "npm", args: ["run", "build"], exitCode: 0, stdout: "ok", stderr: "" }
      })
    ]);
    expect(state.activity[0].title).toBe("npm test");
    expect((state.activity[0] as any).metric).toBe("exit 1");
    expect(state.activity[0].status).toBe("failed");
    expect((state.activity[1] as any).metric).toBeUndefined();
    expect(state.activity[1].status).toBe("completed");
  });

  it("folds a run of reads into one row that names the first file and counts the rest", () => {
    const state = reduceAll([
      ev("tool.completed", { tool: "read_file", target: "src/pagination.ts", result: { path: "src/pagination.ts" } }),
      ev("tool.completed", { tool: "read_file", target: "src/money.ts", result: { path: "src/money.ts" } }),
      ev("tool.completed", { tool: "read_file", target: "src/index.ts", result: { path: "src/index.ts" } })
    ]);
    expect(state.activity).toHaveLength(1);
    const group = state.activity[0];
    expect(isActivityGroup(group)).toBe(true);
    expect(group.title).toBe("Read 3 files");
    expect(group.shortDescription).toBe("pagination.ts +2 more");
  });
});

describe("the outcome is the row the eye lands on", () => {
  it("says why in plain language, once, rather than twice in the runtime's words", () => {
    const state = reduceAll([
      ev("task.started"),
      ev("agent.limit_reached", { limit: "maxExecutionTimeMs" }),
      ev("task.failed", { error: "Limit reached", payload: { code: "LIMIT_REACHED", message: "maxExecutionTimeMs" } })
    ]);
    expect(state.activity).toHaveLength(1);
    const outcome = state.activity[0];
    expect(outcome.level).toBe("outcome");
    expect(outcome.title).toBe("Task failed");
    expect(outcome.shortDescription).toBe("time limit reached");
  });

  it("marks a pending approval as an outcome, because nothing proceeds until it is answered", () => {
    const state = reduceAll([
      ev("interaction.requested", {
        interactionId: "i1",
        interaction: {
          interactionId: "i1",
          taskId: "t1",
          type: "APPROVAL",
          title: "Approval required",
          message: "Modify src/a.ts",
          createdAt: "",
          expiresAt: "",
          approval: { kind: "file_write", tool: "write_file", summary: "Modify src/a.ts (+1 -1)" }
        }
      })
    ]);
    expect(state.activity[0].level).toBe("outcome");
    expect(state.activity[0].title).toBe("Modify src/a.ts (+1 -1)");
  });
});

describe("a chat turn is a conversation", () => {
  const delta = (over: Record<string, unknown>) =>
    ev("model.token_delta", { requestId: "r1", runId: "t1", channel: "main", kind: "text", ...over });

  it("renders the reply and nothing else", () => {
    const state = reduceAll([
      ev("task.started"),
      ev("task.mode_resolved", { mode: "CHAT", source: "model", confidence: 0.9 }),
      ev("agent.status", { status: "Thinking...", state: "THINKING" }),
      delta({ delta: "Yes, it is bounded.", index: 0 }),
      ev("model_request.succeeded", { requestId: "r1", usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }, costUsd: 0.001 }),
      ev("task.completed", { finalText: "Yes, it is bounded." })
    ]);
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].category).toBe("AGENT_MESSAGE");
    expect(state.activity[0].shortDescription).toBe("Yes, it is bounded.");
  });

  it("still shows a failure, which is the one thing a conversation cannot say for itself", () => {
    const state = reduceAll([
      ev("task.mode_resolved", { mode: "CHAT", source: "explicit", confidence: 1 }),
      ev("task.failed", { error: "no provider", payload: { code: "NO_PROVIDER", message: "no provider" } })
    ]);
    expect(titles(state.activity)).toEqual(["Task failed"]);
  });

  it("grows the streamed reply into the final answer instead of printing it twice", () => {
    const state = reduceAll([
      ev("task.started"),
      delta({ delta: "Added a limiter", index: 0 }),
      ev("model_request.succeeded", { requestId: "r1", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }),
      ev("task.completed", { finalText: "Added a limiter to the login route. Tests pass." })
    ]);
    const messages = state.activity.filter(a => !isActivityGroup(a) && a.category === "AGENT_MESSAGE");
    expect(messages).toHaveLength(1);
    expect(messages[0].shortDescription).toBe("Added a limiter to the login route. Tests pass.");
    expect(state.finalText).toBe("Added a limiter to the login route. Tests pass.");
  });

  it("gives the reply a row when it never streamed", () => {
    const state = reduceAll([ev("task.started"), ev("task.completed", { finalText: "Nothing needed changing." })]);
    const messages = state.activity.filter(a => !isActivityGroup(a) && a.category === "AGENT_MESSAGE");
    expect(messages).toHaveLength(1);
    expect(messages[0].shortDescription).toBe("Nothing needed changing.");
  });
});
