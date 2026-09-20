import { describe, it, expect } from "vitest";
import {
  ActivityItem,
  MAX_ACTIVITY_ENTRIES,
  MAX_SEEN_EVENT_IDS,
  applySequenced,
  applySnapshot,
  capActivity,
  createInitialSessionState,
  isActivityGroup,
  reduceEvent,
  rememberEvent,
  startTask
} from "../src/index.js";

let counter = 0;
function ev(type: string, extra: Record<string, unknown> = {}): any {
  counter += 1;
  return { type, eventId: `e${counter}`, taskId: "t1", timestamp: "2026-09-20T10:00:00.000Z", ...extra };
}

function reduceAll(events: any[], initial = createInitialSessionState()) {
  return events.reduce((s, e) => reduceEvent(s, e), initial);
}

describe("reduceEvent: task lifecycle", () => {
  it("tracks status, agent state and the resolved mode", () => {
    const state = reduceAll([
      ev("task.started"),
      ev("task.mode_resolved", { mode: "AGENT", source: "explicit", confidence: 1 }),
      ev("agent.status", { status: "THINKING" })
    ]);
    expect(state.status).toBe("running");
    expect(state.agentState).toBe("THINKING");
    expect(state.mode).toBe("AGENT");
    expect(state.modeSource).toBe("explicit");
  });

  it("records the final text and end time on completion", () => {
    const state = reduceAll([ev("task.started"), ev("task.completed", { finalText: "All done." })]);
    expect(state.status).toBe("completed");
    expect(state.agentState).toBe("COMPLETED");
    expect(state.finalText).toBe("All done.");
    expect(state.timing.endedAt).toBeGreaterThan(0);
  });

  it("captures a structured error on failure", () => {
    const state = reduceAll([ev("task.failed", { error: "boom", payload: { code: "WORKSPACE_REQUIRED", message: "no workspace" } })]);
    expect(state.status).toBe("failed");
    expect(state.error).toEqual({ code: "WORKSPACE_REQUIRED", message: "no workspace" });
  });

  it("ignores a duplicate event", () => {
    const duplicate = ev("change.created", { path: "src/a.ts", operation: "CREATE" });
    const state = reduceAll([duplicate, duplicate, duplicate]);
    expect(state.changes).toHaveLength(1);
    expect(state.activity).toHaveLength(1);
  });

  it("startTask resets task data but keeps the connection", () => {
    const previous = reduceAll([ev("task.started"), ev("change.created", { path: "a.ts", operation: "CREATE" })]);
    previous.connection = "online";
    const next = startTask(previous, { taskId: "t2", prompt: "do it", autonomy: "ask", mode: "AGENT" });
    expect(next.connection).toBe("online");
    expect(next.changes).toEqual([]);
    expect(next.activity).toEqual([]);
    expect(next.taskId).toBe("t2");
    expect(next.mode).toBe("AGENT");
  });
});

describe("reduceEvent: plan", () => {
  const plan = {
    planId: "p1",
    goal: "add a helper",
    steps: [
      { id: "s1", type: "INVESTIGATE", title: "Look", description: "", status: "PENDING" },
      { id: "s2", type: "IMPLEMENT", title: "Write", description: "", status: "PENDING" },
      { id: "s3", type: "VALIDATE", title: "Verify", description: "", status: "PENDING" }
    ]
  };

  it("derives the current step and completed count as steps progress", () => {
    let state = reduceEvent(createInitialSessionState(), ev("plan.created", { plan, planVersion: 1 }));
    expect(state.plan?.steps).toHaveLength(3);
    expect(state.plan?.currentIndex).toBe(0);

    state = reduceEvent(state, ev("plan.step.started", { stepId: "s1" }));
    expect(state.plan?.currentIndex).toBe(0);
    expect(state.plan?.steps[0].status).toBe("RUNNING");

    state = reduceEvent(state, ev("plan.step.completed", { stepId: "s1", resultSummary: "found it" }));
    expect(state.plan?.completedCount).toBe(1);
    expect(state.plan?.currentIndex).toBe(1);
    expect(state.plan?.steps[0].resultSummary).toBe("found it");

    state = reduceEvent(state, ev("plan.step.failed", { stepId: "s2", error: "nope" }));
    expect(state.plan?.steps[1].status).toBe("FAILED");
  });

  it("replaces the plan on revision", () => {
    let state = reduceEvent(createInitialSessionState(), ev("plan.created", { plan, planVersion: 1 }));
    const revised = { ...plan, steps: [...plan.steps, { id: "s4", type: "REPAIR", title: "Fix", status: "PENDING" }] };
    state = reduceEvent(state, ev("plan.updated", { plan: revised, planVersion: 2, mutationReason: "verification failed" }));
    expect(state.plan?.version).toBe(2);
    expect(state.plan?.steps).toHaveLength(4);
  });
});

describe("reduceEvent: approvals", () => {
  const approval = {
    interactionId: "act-1",
    taskId: "t1",
    type: "APPROVAL",
    title: "Approval required",
    message: "Modify src/a.ts",
    createdAt: "2026-09-20T10:00:00.000Z",
    expiresAt: "2026-09-20T10:10:00.000Z",
    approval: {
      kind: "file_write",
      tool: "write_file",
      summary: "Modify src/a.ts (+1 -1)",
      file: { path: "src/a.ts", operation: "MODIFY", diff: "@@\n+new\n-old\n", additions: 1, deletions: 1 },
      scopes: [{ key: "file:src/a.ts", label: "this file" }]
    }
  };

  it("surfaces a pending approval with its payload and clears it on decision", () => {
    let state = reduceEvent(createInitialSessionState(), ev("interaction.requested", { interactionId: "act-1", interaction: approval }));
    expect(state.status).toBe("waiting_for_user");
    expect(state.pendingApproval?.payload?.file?.diff).toContain("+new");
    expect(state.pendingApproval?.payload?.scopes).toHaveLength(1);

    state = reduceEvent(state, ev("approval.decided", {
      tool: "write_file", kind: "file_write", summary: "Modify src/a.ts (+1 -1)",
      approved: true, decision: "APPROVED_SESSION", scopeKey: "dir:src/"
    }));
    expect(state.pendingApproval).toBeUndefined();
    expect(state.approvals).toHaveLength(1);
    expect(state.approvals[0].scopeKey).toBe("dir:src/");
  });

  it("keeps the whole decision journal, including automatic denials", () => {
    const state = reduceAll([
      ev("approval.decided", { tool: "write_file", kind: "file_write", summary: "a", approved: false, decision: "NO_HUMAN_OBSERVER" }),
      ev("approval.decided", { tool: "git_push", kind: "git_push", summary: "b", approved: false, decision: "DENIED" })
    ]);
    expect(state.approvals.map(a => a.decision)).toEqual(["NO_HUMAN_OBSERVER", "DENIED"]);
    const titles = state.activity.map(a => (isActivityGroup(a) ? a.title : a.title));
    expect(titles.every(t => t.startsWith("Not approved"))).toBe(true);
  });
});

describe("reduceEvent: usage and cost", () => {
  it("accumulates tokens and cost across requests", () => {
    const state = reduceAll([
      ev("model_request.succeeded", { requestId: "r1", usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 }, costUsd: 0.001 }),
      ev("model_request.succeeded", { requestId: "r2", usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 }, costUsd: 0.0005 })
    ]);
    expect(state.usage.totalTokens).toBe(180);
    expect(state.usage.requests).toBe(2);
    expect(state.usage.costKnown).toBe(true);
    expect(state.usage.costUsd).toBeCloseTo(0.0015, 10);
  });

  it("reports cost as unknown rather than zero when any request has no price", () => {
    const state = reduceAll([
      ev("model_request.succeeded", { requestId: "r1", usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 }, costUsd: 0.1 }),
      ev("model_request.succeeded", { requestId: "r2", usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 } })
    ]);
    expect(state.usage.totalTokens).toBe(22);
    expect(state.usage.costKnown).toBe(false);
    expect(state.usage.costUsd).toBeUndefined();
  });
});

describe("reduceEvent: streaming", () => {
  const delta = (over: Record<string, unknown>) =>
    ev("model.token_delta", { requestId: "r1", runId: "t1", channel: "main", kind: "text", ...over });

  it("appends main-channel deltas in order", () => {
    const state = reduceAll([
      delta({ delta: "Hel", index: 0 }),
      delta({ delta: "lo ", index: 1 }),
      delta({ delta: "world", index: 2 })
    ]);
    expect(state.streaming?.text).toBe("Hello world");
    expect(state.streaming?.lastIndex.text).toBe(2);
    expect(state.activity).toHaveLength(0); // no timeline entry until the turn ends
  });

  it("keeps reasoning separate from text", () => {
    const state = reduceAll([
      delta({ delta: "why", index: 0, kind: "reasoning" }),
      delta({ delta: "answer", index: 0, kind: "text" })
    ]);
    expect(state.streaming?.reasoning).toBe("why");
    expect(state.streaming?.text).toBe("answer");
  });

  it("ignores a duplicate delta and raises a resync on a dropped one", () => {
    let state = reduceAll([delta({ delta: "a", index: 0 }), delta({ delta: "a", index: 0 })]);
    expect(state.streaming?.text).toBe("a");
    expect(state.replication.needsResync).toBe(false);

    state = reduceEvent(state, delta({ delta: "c", index: 2 }));
    expect(state.replication.needsResync).toBe(true);
  });

  it("accepts a coalesced delta covering a range without tripping gap detection", () => {
    let state = reduceEvent(createInitialSessionState(), delta({ delta: "abc", index: 0, endIndex: 2 }));
    expect(state.streaming?.lastIndex.text).toBe(2);
    state = reduceEvent(state, delta({ delta: "de", index: 3, endIndex: 4 }));
    expect(state.streaming?.text).toBe("abcde");
    expect(state.replication.needsResync).toBe(false);
  });

  it("folds the finished stream into one activity item when the request succeeds", () => {
    let state = reduceAll([delta({ delta: "Here is ", index: 0 }), delta({ delta: "the answer.", index: 1 })]);
    state = reduceEvent(state, ev("model_request.succeeded", { requestId: "r1", usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } }));
    expect(state.streaming).toBeUndefined();
    const message = state.activity.find(a => !isActivityGroup(a) && a.category === "AGENT_MESSAGE") as ActivityItem;
    expect(message).toBeDefined();
    expect(message.details?.text).toBe("Here is the answer.");
  });

  it("routes worker deltas to that worker and never into the main stream", () => {
    let state = reduceEvent(createInitialSessionState(), ev("subagent.started", { subagentId: "sub-1", subagentType: "RESEARCH", goal: "find auth" }));
    state = reduceEvent(state, delta({ channel: "subagent", subagentId: "sub-1", delta: "Looking", index: 0 }));
    state = reduceEvent(state, delta({ channel: "subagent", subagentId: "sub-1", delta: " at auth.ts", index: 1 }));

    expect(state.streaming).toBeUndefined();
    expect(state.workers[0].streamText).toBe("Looking at auth.ts");

    // A main-channel delta arriving alongside keeps its own buffer.
    state = reduceEvent(state, delta({ delta: "main text", index: 0 }));
    expect(state.streaming?.text).toBe("main text");
    expect(state.workers[0].streamText).toBe("Looking at auth.ts");
  });
});

describe("reduceEvent: workers and changes", () => {
  it("upserts workers by id rather than duplicating them", () => {
    const state = reduceAll([
      ev("subagent.started", { subagentId: "s1", subagentType: "RESEARCH", goal: "find" }),
      ev("subagent.completed", { subagentId: "s1", subagentType: "RESEARCH", result: { summary: "found" } })
    ]);
    expect(state.workers).toHaveLength(1);
    expect(state.workers[0].status).toBe("COMPLETED");
    expect(state.workers[0].goal).toBe("find");
    expect(state.workers[0].summary).toBe("found");
  });

  it("records each changed file once, keeping the original operation", () => {
    const state = reduceAll([
      ev("change.created", { path: "src/a.ts", operation: "CREATE" }),
      ev("change.created", { path: "src/a.ts", operation: "MODIFY" }),
      ev("change.created", { path: "src/b.ts", operation: "MODIFY" })
    ]);
    expect(state.changes.map(c => [c.path, c.operation])).toEqual([["src/a.ts", "CREATE"], ["src/b.ts", "MODIFY"]]);
  });

  it("has no per-change decision field, because nothing reverts a written file", () => {
    const state = reduceEvent(createInitialSessionState(), ev("change.created", { path: "a.ts", operation: "CREATE" }));
    expect(Object.keys(state.changes[0])).toEqual(["path", "operation"]);
  });
});

describe("activity grouping and bounds", () => {
  it("collapses consecutive reads into one group and breaks the run on a different activity", () => {
    const state = reduceAll([
      ev("tool.completed", { tool: "read_file", path: "a.ts" }),
      ev("tool.completed", { tool: "read_file", path: "b.ts" }),
      ev("tool.completed", { tool: "read_file", path: "c.ts" }),
      ev("tool.completed", { tool: "write_file", path: "d.ts" }),
      ev("tool.completed", { tool: "read_file", path: "e.ts" })
    ]);
    expect(state.activity).toHaveLength(3);
    const group = state.activity[0];
    expect(isActivityGroup(group)).toBe(true);
    expect((group as any).items).toHaveLength(3);
    expect(group.title).toBe("Read 3 files");
  });

  it("caps the timeline at the runtime's own ceiling and counts what was elided", () => {
    const entries: ActivityItem[] = Array.from({ length: MAX_ACTIVITY_ENTRIES + 10 }, (_, i) => ({
      id: `i${i}`, category: "SYSTEM_EVENT", status: "completed", title: `item ${i}`, timestamp: "2026-09-20T10:00:00.000Z"
    }));
    const { entries: capped, elided } = capActivity(entries);
    expect(capped).toHaveLength(MAX_ACTIVITY_ENTRIES);
    expect(elided).toBe(10);
    expect(capped[0].title).toBe("item 10");
  });

  it("bounds the dedupe window and keeps it serialisable", () => {
    let seen: string[] = [];
    for (let i = 0; i < MAX_SEEN_EVENT_IDS + 50; i++) seen = rememberEvent(seen, `k${i}`);
    expect(seen).toHaveLength(MAX_SEEN_EVENT_IDS);
    expect(seen[seen.length - 1]).toBe(`k${MAX_SEEN_EVENT_IDS + 49}`);
    expect(Array.isArray(seen)).toBe(true);
    expect(() => JSON.parse(JSON.stringify(seen))).not.toThrow();
  });

  it("a whole session state survives a JSON round trip", () => {
    const state = reduceAll([
      ev("task.started"),
      ev("plan.created", { plan: { planId: "p", goal: "g", steps: [{ id: "s1", type: "IMPLEMENT", title: "t", status: "PENDING" }] }, planVersion: 1 }),
      ev("change.created", { path: "a.ts", operation: "CREATE" })
    ]);
    const round = JSON.parse(JSON.stringify(state));
    expect(round).toEqual(state);
  });
});

describe("sequenced replication", () => {
  const seq = (n: number, event: any) => ({ seq: n, event });

  it("applies a contiguous run", () => {
    let state = applySnapshot(createInitialSessionState(), -1);
    state = applySequenced(state, seq(0, ev("task.started")));
    state = applySequenced(state, seq(1, ev("change.created", { path: "a.ts", operation: "CREATE" })));
    expect(state.replication.lastSeq).toBe(1);
    expect(state.replication.needsResync).toBe(false);
    expect(state.changes).toHaveLength(1);
  });

  it("raises a resync on a gap and refuses everything after it until a snapshot", () => {
    let state = applySnapshot(createInitialSessionState(), -1);
    state = applySequenced(state, seq(0, ev("task.started")));
    state = applySequenced(state, seq(2, ev("change.created", { path: "a.ts", operation: "CREATE" })));

    expect(state.replication.needsResync).toBe(true);
    expect(state.replication.gapAt).toBe(2);
    expect(state.changes).toHaveLength(0); // the event was refused, not applied out of order

    state = applySequenced(state, seq(3, ev("change.created", { path: "b.ts", operation: "CREATE" })));
    expect(state.changes).toHaveLength(0);

    const authoritative = reduceAll([ev("task.started"), ev("change.created", { path: "a.ts", operation: "CREATE" })]);
    state = applySnapshot(authoritative, 3);
    expect(state.replication.needsResync).toBe(false);
    expect(state.replication.lastSeq).toBe(3);
    expect(state.changes).toHaveLength(1);
  });

  it("ignores a replayed sequence without asking for a resync", () => {
    let state = applySnapshot(createInitialSessionState(), -1);
    state = applySequenced(state, seq(0, ev("task.started")));
    const beforeReplay = state;
    state = applySequenced(state, seq(0, ev("task.started")));
    expect(state).toBe(beforeReplay);
    expect(state.replication.needsResync).toBe(false);
  });
});
