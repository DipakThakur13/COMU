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

## What earns a row

The reduction has two passes. The first folds an event into `SessionState`. The second,
`normalizeEvent`, decides whether that event is something a person would say *happened* — and it
answers no far more often than yes.

| Event | Row |
| --- | --- |
| `agent.status`, `task.started`, `tool.started`, `verification.started`, `repair.started`, `plan.step.started`, `plan.step.completed`, `memory.retrieved` | none; they set `live` |
| `tool.completed` | one row for the whole call: `Read login.ts`, `Searched "fetchRecord"`, `npm test` |
| `tool.completed` for a successful write | none; `change.created` reports it with the file and its size |
| `agent.limit_reached` | none; it records `limit`, which the failure row then gives as its reason |
| `task.completed` / `task.failed` / `task.cancelled` | one `outcome` row |

Every row declares a **level**, and the interface renders the three differently:

- `outcome` — finished, failed, or blocked on a person. One per task, bordered, with its reason in
  plain language.
- `substance` — work that changed or decided something: edits, commands, verification, repairs,
  approvals, the assistant's prose.
- `routine` — looking around: reads, searches, directory listings. Dimmed, and folded by
  `appendActivity` into one row with a count when consecutive and of the same kind.

`metric` is the row's single measurement (`+12 −3`, `2 failed`, `18 matches`) and is **undefined
when there is nothing to measure**. Nothing in the interface renders a placeholder value.

`live` is what is happening *now*: one label and a start time, replaced in place and cleared on any
terminal state. It is never appended to `activity`, which is why the stream contains only things
that happened. See
[decision 0016](../../docs/decisions/0016-the-activity-stream-reports-work-not-state.md).

## Bounds

| Bound | Value | Why |
| --- | --- | --- |
| `MAX_ACTIVITY_ENTRIES` | 5000 | Matches the runtime's own event-store ceiling. Overflow is dropped from the front and counted in `elidedCount` so the interface can say so. |
| `MAX_SEEN_EVENT_IDS` | 2000 | Dedupe window; bounded so a long task cannot grow it without limit, and an array so it survives `postMessage`. |
| `MAX_STREAM_CHARS` | 200000 | Live streaming buffer; the accumulated final text arrives separately on `task.completed`. |
