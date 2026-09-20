import { AgentEvent } from "@comu/protocol";
import { SequencedEvent, SessionState } from "./types.js";

/**
 * Assigns the monotonic per-task sequence the replica relies on.
 *
 * Lives on the authoritative side (the extension host). A sequence is per task, starts at 0 and
 * never skips, so any gap the replica observes is a genuine dropped message rather than a
 * numbering artefact.
 */
export class EventSequencer {
  private counters = new Map<string, number>();

  public next(taskId: string, event: AgentEvent): SequencedEvent {
    const seq = (this.counters.get(taskId) ?? -1) + 1;
    this.counters.set(taskId, seq);
    return { seq, event };
  }

  public current(taskId: string): number {
    return this.counters.get(taskId) ?? -1;
  }

  public reset(taskId: string): void {
    this.counters.delete(taskId);
  }

  public forget(taskId: string): void {
    this.counters.delete(taskId);
  }
}

/** True when the replica can no longer be trusted and needs a fresh snapshot. */
export function needsResync(state: SessionState): boolean {
  return state.replication.needsResync;
}

/**
 * Coalesces token deltas so a burst of chunks becomes one forwarded message per frame.
 *
 * Streaming providers emit a delta per chunk, often many per animation frame. Forwarding each one
 * across `postMessage` would cost more than rendering them. Deltas for the same
 * (requestId, channel, kind) are merged, keeping the first index so gap detection still works, and
 * flushed by the scheduler the caller provides.
 */
export class DeltaCoalescer {
  private pending = new Map<string, any>();
  private order: string[] = [];
  private scheduled = false;

  constructor(
    private readonly flushTo: (events: AgentEvent[]) => void,
    private readonly schedule: (cb: () => void) => void = cb => setTimeout(cb, 16)
  ) {}

  /** Returns true when the event was absorbed into the buffer, false when it should pass through. */
  public push(event: AgentEvent): boolean {
    if (event.type !== "model.token_delta") {
      // Ordering matters: anything non-delta must not overtake buffered text.
      this.flushNow();
      return false;
    }
    const e = event as any;
    const key = `${e.requestId}|${e.channel}|${e.subagentId || ""}|${e.kind}`;
    const existing = this.pending.get(key);
    if (existing) {
      existing.delta += e.delta;
      // Keep the range: `index` stays the first delta in the batch, `endIndex` moves to the last,
      // so the receiver validates continuity against the first and resumes from the last.
      existing.endIndex = e.index;
    } else {
      this.pending.set(key, { ...e, endIndex: e.index });
      this.order.push(key);
    }
    this.ensureScheduled();
    return true;
  }

  public flushNow(): void {
    if (this.pending.size === 0) return;
    const events = this.order.map(k => this.pending.get(k)).filter(Boolean) as AgentEvent[];
    this.pending.clear();
    this.order = [];
    this.flushTo(events);
  }

  public dispose(): void {
    this.pending.clear();
    this.order = [];
  }

  private ensureScheduled() {
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      this.flushNow();
    });
  }
}
