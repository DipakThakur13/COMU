import { describe, it, expect } from "vitest";
import type { AgentEvent } from "@comu/protocol";
import {
  MAX_THREAD_TURNS,
  applySequenced,
  createInitialSessionState,
  reduceEvent,
  restoreThread,
  restoredTurn,
  startTask,
  threadEntries,
  type SessionState,
  type TurnView
} from "../src/index.js";

/**
 * The panel as a thread: each turn is what the user said and what the agent did and said, and a
 * new turn files the previous one away rather than wiping it.
 */

let n = 0;
const ev = (taskId: string, type: string, extra: Record<string, unknown> = {}): AgentEvent =>
  ({ type, taskId, eventId: `e${++n}`, timestamp: "2026-09-24T10:00:00.000Z", ...extra }) as unknown as AgentEvent;

function playTurn(state: SessionState, taskId: string, prompt: string, answer: string): SessionState {
  let s = reduceEvent(state, ev(taskId, "turn.started", { turnId: `turn-${taskId}`, prompt }));
  s = reduceEvent(s, ev(taskId, "task.started"));
  s = reduceEvent(s, ev(taskId, "task.mode_resolved", { mode: "ASK", source: "deterministic" }));
  return reduceEvent(s, ev(taskId, "task.completed", { finalText: answer, verification: "NOT_VERIFIED" }));
}

describe("the thread", () => {
  it("files the live turn away when the next one starts, keeping both answers", () => {
    let s = createInitialSessionState();
    s = playTurn(s, "t1", "give me an HTML snippet", "<button>Buy</button>");
    s = playTurn(s, "t2", "add inline CSS to it", '<button style="color:red">Buy</button>');

    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ taskId: "t1", prompt: "give me an HTML snippet", status: "completed", mode: "ASK" });
    expect(s.taskId).toBe("t2");
    expect(s.prompt).toBe("add inline CSS to it");

    const rows = threadEntries(s);
    const said = rows.map(r => ("title" in r ? `${r.category}:${r.title}` : r.id));
    expect(said[0]).toBe("USER_MESSAGE:give me an HTML snippet");
    expect(said).toContain("USER_MESSAGE:add inline CSS to it");
    // Every completed turn has a final-message row; filed turns keep theirs, ids unique across the thread.
    const ids = rows.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const answers = rows.filter(r => "category" in r && r.category === "AGENT_MESSAGE").map(r => ("details" in r ? JSON.stringify(r.details) : ""));
    expect(answers.join(" ")).toContain("<button>Buy</button>");
    expect(answers.join(" ")).toContain('style=\\"color:red\\"');
  });

  it("does not file a turn twice when the host began it before its turn.started arrived", () => {
    let s = playTurn(createInitialSessionState(), "t1", "first", "one");
    s = startTask(s, { taskId: "t2", prompt: "second", autonomy: "ask" });
    expect(s.turns).toHaveLength(1);
    s = reduceEvent(s, ev("t2", "turn.started", { turnId: "turn-t2", prompt: "second" }));
    expect(s.turns).toHaveLength(1);
    expect(s.turnId).toBe("turn-t2");
  });

  it("crosses the replica's sequenced path like any other event", () => {
    let s = createInitialSessionState();
    s = applySequenced(s, { seq: 0, event: ev("t1", "turn.started", { turnId: "turn-t1", prompt: "hello" }) });
    expect(s.prompt).toBe("hello");
    expect(s.replication.lastSeq).toBe(0);
  });

  it("restores turns from the session only into a panel that has none", () => {
    const restored: TurnView[] = [{ turnId: "turn-old", prompt: "earlier", status: "completed", activity: [], restored: true }];
    const fresh = restoreThread(createInitialSessionState(), restored);
    expect(threadEntries(fresh)[0]).toMatchObject({ category: "USER_MESSAGE", title: "earlier" });

    const live = playTurn(playTurn(createInitialSessionState(), "t1", "a", "b"), "t2", "c", "d");
    expect(restoreThread(live, restored).turns.map(t => t.prompt)).toEqual(["a"]);
  });

  it("rebuilds a recorded turn in the same row vocabulary a live one uses", () => {
    const view = restoredTurn({
      turnId: "turn-t9",
      taskId: "t9",
      userMessage: "undo that",
      mode: "AGENT",
      status: "failed",
      finalText: "Reverted src/greet.ts.",
      error: "Verification could not run",
      changes: [{ path: "src/greet.ts", operation: "MODIFY", additions: 1, deletions: 1 }],
      verification: "UNAVAILABLE",
      startedAt: "2026-09-24T10:00:00.000Z",
      endedAt: "2026-09-24T10:01:00.000Z"
    });
    expect(view).toMatchObject({ prompt: "undo that", status: "failed", restored: true, completedVerification: "UNAVAILABLE" });
    expect(view.activity.map(r => ("title" in r ? r.title : r.id))).toEqual(["Edited greet.ts", "Verification unavailable", "Assistant"]);
    expect(view.activity[0]).toMatchObject({ toolCategory: "Edit", metric: "+1 −1", shortDescription: "src/greet.ts" });
    expect((view.activity[2] as { shortDescription?: string }).shortDescription).toContain("Verification could not run");
  });

  it("keeps at most MAX_THREAD_TURNS finished turns in the panel", () => {
    let s = createInitialSessionState();
    for (let i = 0; i < MAX_THREAD_TURNS + 5; i++) s = playTurn(s, `t${i}`, `q${i}`, `a${i}`);
    expect(s.turns).toHaveLength(MAX_THREAD_TURNS);
    expect(s.turns.at(-1)?.prompt).toBe(`q${MAX_THREAD_TURNS + 3}`);
  });
});
