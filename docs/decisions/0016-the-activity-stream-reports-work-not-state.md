# 0016. The activity stream reports the agent's work, not the orchestrator's state

Status: accepted
Area: Extension ↔ webview

## Problem

A task that made two directory listings produced thirteen rows:

```
Executing tools...
Generic started: list_directory
       list_directory
Generic completed: list_directory
       list_directory
Observing results
Thinking...
Executing tools...
Generic started: list_directory
       list_directory
Generic completed: list_directory
       list_directory
Observing results
Max execution time reached
Task failed: LIMIT_REACHED
```

Four rows printed the tool's name twice. Three of them — `Executing tools`, `Observing results`,
`Thinking` — are not events at all; they are the absence of one, promoted to permanent history.
One said `Generic`, an internal fallback category that had escaped into the product. And the only
row a person cares about, the failure and its cause, carried the same grey dot, the same weight and
the same chevron as `Observing results`.

The reduction was a faithful mirror of the orchestrator's state machine. That was the defect: the
state machine is not what a person is trying to find out. They want to know what the agent *did*.

Two smaller symptoms had the same root. A conversational reply rendered
`CLASSIFYING → Mode: CHAT → THINKING → Assistant → COMPLETED → Task completed`: six rows of pipeline
around one sentence. And the answer was printed twice, truncated in the stream and again in full in
a panel below it.

## Options

**1. Restyle: dim the machinery, colour the exceptions.** Rejected. The rows would still be there,
still costing the vertical space that is the scarcest resource in a 350px panel, and a dimmed row
still has to be read before it can be skipped.

**2. Filter in the component.** Rejected. The extension host and the webview run the same reducer
so that neither re-implements what an event means ([0001](0001-replicated-reducer-with-sequenced-events.md)).
A filter in the view puts product knowledge back in one side only, and the host's snapshot would
still carry rows nobody ever renders.

**3. A second pass over the normalised events, in the shared reducer.** Chosen.

## Choice

`normalizeEvent` is the pass that decides what earns a row, and it answers "null" far more often
than it used to.

- **State transitions produce nothing.** `agent.status`, `task.started`, `tool.started`,
  `verification.started`, `repair.started`, `plan.step.started`, `plan.step.completed` and
  `memory.retrieved` set `SessionState.live` — a single line, pinned below the stream, replaced in
  place and removed when the task ends — and never append to history.
- **One action is one row.** A tool's start and its completion are one action: the start drives the
  live line, the completion produces the row. A successful write produces no tool row at all,
  because `change.created` follows it and says the same thing with the file's name and its size.
- **A limit is a reason, not an event.** `agent.limit_reached` records why on the state; the
  `task.failed` that follows ([0009](0009-every-task-ends-with-exactly-one-terminal-event.md))
  renders one outcome row that says "Failed · time limit reached".
- **Every row declares a level** — `outcome`, `substance` or `routine` — and the interface renders
  the three differently: a bordered block, a normal row with a measurement, or a dimmed compact
  line. Consecutive routine rows of the same kind fold into one (`Read 3 files · pagination.ts +2
  more`), expandable into the list.
- **In CHAT mode only outcomes survive**, so a conversational turn is the conversation.
- **`task.completed` folds its final text into the row the reply streamed into** when the two agree,
  instead of adding a second copy. The drawer's "Result" section is gone for the same reason.

The runtime had to publish three things it was keeping to itself, because an interface that is only
told the tool's name can say nothing more useful than the tool's name:

- `tool.started` / `tool.completed` carry `target`: the one bounded string that says what the call
  was about — a path, a query, a command line. Deliberately not the argument object, which would
  put file content into the event stream.
- `agent.status` carries `state` alongside its message, so a consumer never infers the state from
  the wording of a sentence written for a log. The old header inferred it and was wrong for every
  transition that carried a message, which is most of them.
- `change.created` carries `additions` and `deletions`, counted from the same diff the approval card
  would have shown, so an edit made without an approval can still report its size.

## Reasoning

**The rule is "what happened", and it is checkable.** "Is this a thing the agent did, or a state
the loop was in?" decides every case, including ones not yet written. `tests/activity_rows.test.ts`
is that rule as assertions: the first test feeds thirteen state transitions and expects an empty
stream.

**A measurement slot that renders a dead value is worse than no slot.** `cost unknown` occupied a
third of the header's second line to say nothing. A model with no published price now contributes
no cost at all, and the same rule governs every `metric`: it is undefined when there is nothing to
measure.

**Grouping stays incremental.** Folding a run of reads happens as each row is appended, not by
re-reducing the history on every event, so a five-thousand-row task costs the same per event as an
empty one. Group ids are keyed on the first row rather than on the size, so a group that grows keeps
its identity and does not collapse under an open chevron.

**Colour means one thing.** Failure, success, or waiting. Routine work is default foreground however
it is categorised, which is what lets a failed command be found without reading the rows above it.

## Consequences

- The snapshot baselines were regenerated once, deliberately. Nothing else could have caught the
  density change, and nothing else should be allowed to regenerate them silently.
- A new event type defaults to no row. That is the right default, but it means adding an event is
  not enough to make it visible: it needs a case in `normalizeEvent` and a level.
- `SessionState` gained `live` and `limit`. Both cross `postMessage` in the snapshot, and both are
  plain data, so replication is unaffected.
- The Overview drawer tab no longer appears for a task that merely finished. With the reply in the
  stream and the status in the header, it had nothing left to say.

## See also

- `packages/ui-state/src/normalize.ts` — what earns a row
- `packages/ui-state/src/group.ts` — folding a run of routine work
- `packages/ui-state/tests/activity_rows.test.ts` — the rule, as assertions
- [0001](0001-replicated-reducer-with-sequenced-events.md) — why the reduction is shared rather than
  per client
