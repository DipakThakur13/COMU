# @comu/ui-state

The single event-to-state reduction shared by the VS Code extension host and the webview.

Pure TypeScript: no DOM, no `vscode` import, no I/O, no clock beyond the timestamps events carry.
That is what makes it unit testable and what lets the host and the webview agree without either
side re-implementing product knowledge about what an event means.

## Replication model

The **extension host is authoritative**. It reduces every runtime event into a `SessionState` and
forwards each event to the webview with a monotonic per-task sequence number. The webview holds a
**replica** built from a snapshot plus a contiguous run of sequenced events.

- Duplicates are ignored (`seenEventIds`, a bounded and serialisable window).
- A **gap** in the sequence means an event was dropped. The replica refuses the event, raises
  `replication.needsResync`, and the consumer requests a fresh snapshot. Dedupe alone cannot
  detect a drop, which is why the sequence exists.
- Token deltas carry their own monotonic index per `(requestId, kind)`; a gap there raises the
  same resync, because live text with a hole in it is worse than briefly stale text.

## Bounds

| Bound | Value | Why |
| --- | --- | --- |
| `MAX_ACTIVITY_ENTRIES` | 5000 | Matches the runtime's own event-store ceiling. Overflow is dropped from the front and counted in `elidedCount` so the interface can say so. |
| `MAX_SEEN_EVENT_IDS` | 2000 | Dedupe window; bounded so a long task cannot grow it without limit, and an array so it survives `postMessage`. |
| `MAX_STREAM_CHARS` | 200000 | Live streaming buffer; the accumulated final text arrives separately on `task.completed`. |
