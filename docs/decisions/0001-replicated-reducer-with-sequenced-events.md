# 0001. The panel holds a replica built from a snapshot plus sequenced events

Status: accepted
Area: extension host ↔ webview

## Problem

The VS Code panel has to show what a running task is doing: agent messages streaming in token by
token, tool calls starting and finishing, a plan advancing, approvals arriving and expiring, files
changing. That state lives in the agent runtime. The panel is a webview, reachable only through
`postMessage`, and it can be destroyed and recreated at any time by VS Code when the user hides the
view or reloads the window.

The original implementation kept state in the webview and mutated it from each incoming event,
with no way to tell whether it had seen every event. That has three failure modes, and all three
were observed:

- A dropped or out-of-order message leaves the panel permanently wrong, with nothing to detect it.
  The panel keeps rendering confidently from a state that no longer matches the task.
- A recreated webview starts empty and stays empty for a task already in flight.
- A streaming provider emits a token delta per chunk, many per animation frame. Forwarding each one
  across `postMessage` costs more than rendering it, and the panel falls behind the model.

The underlying question is what the panel *is*: a view of state held elsewhere, or a place where
state lives.

## Options

**1. Send the full state on every change.** Simple and always correct, no sequencing, no gap
detection. Rejected on cost: the state includes the activity log and accumulated streaming text, so
this is tens of kilobytes serialised per token. It also makes every render a full reconciliation.

**2. Keep mutating from events, and add a periodic full resync.** A smaller change to what existed.
Rejected because it makes wrongness time-bounded rather than detected. Between resyncs the panel is
confidently wrong, and the resync interval is a guess trading staleness against cost. It also does
nothing for a webview recreated mid-task.

**3. Move the reducer into the webview and let it own the state.** Tempting, because the panel is
the only consumer. Rejected: the runtime needs the same derived state for its own purposes, and the
extension host has to answer "what is the current state" when a webview is recreated. Two reducers
that must agree is worse than one that runs twice.

**4. Snapshot plus a contiguous run of sequenced events, one reducer shared by both sides.**
Chosen.

## Choice

The extension host is authoritative. It assigns every event a monotonic per-task sequence number
starting at zero, via `EventSequencer` in `packages/ui-state/src/replication.ts`, and keeps the
authoritative state by running the reducer itself.

The webview holds a replica built by running the *same* reducer over a snapshot plus events. The
reducer lives in `@comu/ui-state` and is a pure function, so both sides run identical code.

The replica tracks the last sequence it applied. An event whose sequence is not the next one is a
detected gap: the replica marks itself `needsResync`, stops applying, and asks for a fresh snapshot
rather than continuing from state it can no longer vouch for. A newly created webview uses the same
path, requesting a snapshot at `lastSeq: -1`.

Token deltas are coalesced on a frame boundary by `DeltaCoalescer` before they cross `postMessage`.
Deltas for the same request, channel and kind merge into one message.

The state carries a bounded, serialisable dedupe window of seen event ids, and the activity log is
capped with a count of what was dropped.

## Reasoning

**Detection beats prevention.** We cannot guarantee `postMessage` delivery, so the design makes
undelivered messages loud instead of silent. A sequence number is the cheapest possible mechanism:
one integer per event, and the check is an equality test. The panel's honesty does not depend on
the transport being reliable, only on it being ordered per task, which it is.

**One reducer, not two.** Replication is only correct if both sides agree on what an event means.
Sharing the function makes that true by construction rather than by review. This is the reason
`ui-state` is a package rather than webview code, and why it has no VS Code or React imports.

**Resync is the honest failure mode.** When the replica detects a gap it has exactly one correct
option: stop and ask. Continuing would render a state that is wrong in a way no one can see.
Showing "Reconnecting to the task…" is a worse experience for a second and a better one thereafter.

**Coalescing had to preserve gap detection**, which is the part that is easy to get wrong and was
gotten wrong first. A naive merge sets the coalesced message's index to the first delta's, so the
receiver's next expected index is off by the number of merged deltas and the coalescer trips its own
gap detector. The fix is that a coalesced delta carries a range: `index` stays the first, `endIndex`
moves to the last. The receiver validates continuity against `index` and resumes from `endIndex`.

**The bounds are part of the contract, not an optimisation.** A long task would otherwise grow the
activity log and the dedupe set without limit, and the snapshot crosses `postMessage` on every
resync. The dedupe window is an array rather than a `Set` for the same reason: it has to survive
structured cloning.

## Consequences

- Anything the panel renders must be derivable by the reducer from events. A value that only the
  host knows has to become an event or it cannot be shown.
- The reducer must stay pure and free of platform imports, enforced by the package's dependencies.
- A new event type needs handling in one place, but that place is exercised from both sides.
- Snapshot size is now a real constraint, which is why the caps in `types.ts` exist.

## See also

- `packages/ui-state/src/replication.ts` — sequencing, gap detection, coalescing
- `packages/ui-state/src/reducer.ts` — the shared reducer
- [0004](0004-one-required-abort-signal.md) — the same "make it structural, then enforce it" approach applied to cancellation
