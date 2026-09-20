import { describe, it, expect, vi } from "vitest";
import { DeltaCoalescer, EventSequencer, applySequenced, applySnapshot, createInitialSessionState, needsResync } from "../src/index.js";

function delta(requestId: string, index: number, text: string, over: Record<string, unknown> = {}): any {
  return {
    type: "model.token_delta",
    eventId: `d-${requestId}-${index}`,
    taskId: "t1",
    timestamp: "2026-09-20T10:00:00.000Z",
    requestId,
    runId: "t1",
    channel: "main",
    kind: "text",
    delta: text,
    index,
    ...over
  };
}

describe("EventSequencer", () => {
  it("assigns a contiguous per-task sequence starting at zero", () => {
    const s = new EventSequencer();
    expect(s.next("a", { type: "task.started" } as any).seq).toBe(0);
    expect(s.next("a", { type: "agent.status" } as any).seq).toBe(1);
    expect(s.next("b", { type: "task.started" } as any).seq).toBe(0);
    expect(s.next("a", { type: "task.completed" } as any).seq).toBe(2);
    expect(s.current("a")).toBe(2);
    s.forget("a");
    expect(s.current("a")).toBe(-1);
  });
});

describe("DeltaCoalescer", () => {
  it("merges deltas for the same request into one message per flush, preserving the index range", () => {
    const flushed: any[][] = [];
    let scheduled: (() => void) | undefined;
    const c = new DeltaCoalescer(events => flushed.push(events), cb => { scheduled = cb; });

    expect(c.push(delta("r1", 0, "Hel"))).toBe(true);
    expect(c.push(delta("r1", 1, "lo "))).toBe(true);
    expect(c.push(delta("r1", 2, "world"))).toBe(true);
    expect(flushed).toHaveLength(0); // nothing forwarded yet

    scheduled!();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toHaveLength(1);
    expect(flushed[0][0].delta).toBe("Hello world");
    expect(flushed[0][0].index).toBe(0);
    expect(flushed[0][0].endIndex).toBe(2);
  });

  it("keeps separate buffers per request, channel and kind", () => {
    const flushed: any[][] = [];
    const c = new DeltaCoalescer(events => flushed.push(events), cb => cb());
    c.push(delta("r1", 0, "a"));
    c.push(delta("r1", 0, "why", { kind: "reasoning" }));
    c.push(delta("r2", 0, "b"));
    c.push(delta("r1", 0, "worker", { channel: "subagent", subagentId: "s1" }));
    const all = flushed.flat();
    expect(all).toHaveLength(4);
    expect(new Set(all.map((e: any) => `${e.requestId}|${e.channel}|${e.subagentId || ""}|${e.kind}`)).size).toBe(4);
  });

  it("flushes buffered text before letting a non-delta event through, so ordering holds", () => {
    const flushed: any[][] = [];
    const c = new DeltaCoalescer(events => flushed.push(events), () => {});
    c.push(delta("r1", 0, "partial"));
    expect(flushed).toHaveLength(0);

    const passthrough = c.push({ type: "task.completed", eventId: "x", taskId: "t1", timestamp: "" } as any);
    expect(passthrough).toBe(false);
    expect(flushed).toHaveLength(1);
    expect(flushed[0][0].delta).toBe("partial");
  });

  it("a coalesced stream reconstructs exactly what the replica would have seen unbatched", () => {
    const chunks = ["The ", "quick ", "brown ", "fox ", "jumps"];
    let unbatched = createInitialSessionState();
    chunks.forEach((c, i) => { unbatched = applySequenced(unbatched, { seq: i, event: delta("r1", i, c) }); });

    const forwarded: any[] = [];
    const coalescer = new DeltaCoalescer(events => forwarded.push(...events), cb => cb());
    chunks.forEach((c, i) => coalescer.push(delta("r1", i, c)));

    let batched = createInitialSessionState();
    forwarded.forEach((e, i) => { batched = applySequenced(batched, { seq: i, event: e }); });

    expect(batched.streaming?.text).toBe(unbatched.streaming?.text);
    expect(needsResync(batched)).toBe(false);
  });

  it("dispose drops the buffer without flushing", () => {
    const flush = vi.fn();
    const c = new DeltaCoalescer(flush, () => {});
    c.push(delta("r1", 0, "x"));
    c.dispose();
    c.flushNow();
    expect(flush).not.toHaveBeenCalled();
  });
});

describe("replica recovery", () => {
  it("a resynced replica matches the authoritative state exactly", () => {
    const events = [
      { type: "task.started", eventId: "e1", taskId: "t1", timestamp: "2026-09-20T10:00:00.000Z" },
      { type: "change.created", eventId: "e2", taskId: "t1", timestamp: "2026-09-20T10:00:01.000Z", path: "a.ts", operation: "CREATE" },
      { type: "task.completed", eventId: "e3", taskId: "t1", timestamp: "2026-09-20T10:00:02.000Z", finalText: "done" }
    ] as any[];

    const sequencer = new EventSequencer();
    let host = createInitialSessionState();
    const sequenced = events.map(e => {
      const s = sequencer.next("t1", e);
      host = applySequenced(host, s);
      return s;
    });

    // The replica misses the middle message.
    let replica = createInitialSessionState();
    replica = applySequenced(replica, sequenced[0]);
    replica = applySequenced(replica, sequenced[2]);
    expect(needsResync(replica)).toBe(true);

    replica = applySnapshot(host, sequencer.current("t1"));
    expect(replica).toEqual(host);
    expect(needsResync(replica)).toBe(false);
  });
});
