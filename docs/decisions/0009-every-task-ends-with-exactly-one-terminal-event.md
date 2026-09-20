# 0009. Every task ends with exactly one terminal event, guaranteed by the runtime

Status: accepted
Area: runtime ↔ clients

## Problem

Everything watching a task watches the event stream. The panel shows a spinner, enables and disables
Stop, and decides when to let the user type again. The benchmark harness reads the stream to know a
run is over and it can grade the workspace. Neither has another source of truth: there is no polling
endpoint that reports "still going", and adding one would only move the question.

So the stream has to say when a task is over. It mostly did. The orchestrator emits
`task.completed` on success and `task.failed` on an error, and those two cover the paths anyone
tests.

They do not cover every path. A task that hit a step, tool call or repair limit emitted
`agent.limit_reached` and then stopped — no `task.*` event at all. An exception escaping before the
orchestrator was constructed produced nothing. In both cases the stream simply went quiet.

A quiet stream is indistinguishable from a slow one. The panel spun until the user closed it. The
harness sat until its own wall clock expired, then recorded a harness timeout — which is the
instrument reporting its own failure for something the product did.

The tempting fix is in the client: treat `agent.limit_reached` as terminal too. Two clients already
had versions of that, and it is wrong, for the reason below.

## Options

**1. Clients treat `agent.limit_reached` as terminal.** Rejected. It puts the definition of "over"
in every client, where it has to be kept in step, and it is a list that only ever grows: the next
non-terminal stop needs another entry in every client at once. Worse, it hides the defect. A runtime
that ends a run without saying so is broken whether or not a client compensates, and compensation
means nobody finds out.

**2. Close the HTTP stream and let disconnection mean the end.** Rejected. A dropped connection
already means something else — network trouble, a restart — and a client cannot tell the two apart.
It also carries no reason, so the panel could say a task had ended but never why.

**3. A timeout in each client.** Rejected: it converts every runtime bug into a slow, silent failure
that looks like the model being slow, which is exactly the confusion that started this.

**4. The runtime guarantees the event on every exit path.** Chosen.

## Choice

`ensureTerminalEvent(taskId, failure)` runs at every exit from the task body, including the `catch`.
It reads the task's own event history, returns if a terminal event is already there, and otherwise
emits `task.failed` with a code and a human-readable message. The codes distinguish the cases:
`LIMIT_REACHED` for a run that stopped at a budget, `RUN_ENDED_WITHOUT_TERMINAL_EVENT` for one that
returned a status but published nothing, `RUNTIME_ERROR` for a throw.

The three terminal types stay exactly three — `task.completed`, `task.failed`, `task.cancelled` —
and `agent.limit_reached` is not one of them. It remains an informational event that says why a run
is ending; the `task.failed` that follows says it has ended.

The benchmark harness holds the matching contract: its `TERMINAL` set contains those three and
deliberately excludes `agent.limit_reached`, with a comment saying why. If the runtime ever stops
honouring the guarantee, the harness records a timeout against the run and the defect shows up in
the measurement instead of being absorbed.

## Reasoning

**One producer, many consumers.** The runtime knows a task is over; the clients can only infer it.
Putting the guarantee where the knowledge is means it is written once and cannot drift, and a new
client gets it for free rather than having to learn a list of quiet endings.

**Checking history rather than tracking a flag.** The function asks the event store whether a
terminal event was already emitted. A boolean would be a second piece of state that can disagree
with the stream, and the stream is what clients actually see. Reading the record that clients read
makes "did we say it ended" and "did they hear it end" the same question.

**Refusing to make the client tolerant is the point.** This is the same shape as
[0007](0007-a-stand-in-must-behave-like-the-thing-it-replaces.md): a client that compensates for a
broken producer makes the breakage invisible, and invisible breakage is what gets shipped. The
harness is deliberately intolerant so that the defect has somewhere to surface.

**It was verified by the tests it broke.** Adding the guarantee turned two existing tests red. Both
were asserting that a limit-reached run produced no terminal event — the bug, written down and
protected. That is the strongest available evidence that the behaviour was load-bearing in the
test suite and nowhere else, and both were rewritten to assert the guarantee.

## Consequences

- A stop at a limit now arrives as `task.failed` with code `LIMIT_REACHED`. A client that wants to
  present it differently from a genuine failure reads the code; it must not go back to reading
  `agent.limit_reached` to decide the task is over.
- Any new early return inside the task body must go through `ensureTerminalEvent`. A `return` added
  above it reintroduces the silent stop, and nothing currently catches that automatically.
- `task.failed` is now emitted in cases where the agent did not fail in the ordinary sense — a
  budget was reached. The distinction lives in the code, not in the event type.

## See also

- `apps/agent-runtime/src/server.ts` — `ensureTerminalEvent`
- `benchmarks/src/runner.ts` — `TERMINAL`, the consumer that refuses to compensate
- [0004](0004-one-required-abort-signal.md) — the same principle for cancellation: one mechanism,
  enforced centrally rather than per call site
