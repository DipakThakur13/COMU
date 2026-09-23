# 0017. Meaning travels in a typed field, never in a display string

Status: accepted
Area: Events and contracts

## Problem

Three times now, in three unrelated parts of COMU, a consumer has recovered a decision by reading
prose that was written for a human, and been wrong about it.

**The interaction mode, by substring.** The session store decides which mode a task is in by
uppercasing the status message and looking for words in it:

```ts
if (sUpper.includes("AGENT")) this.state.interactionMode = "AGENT";
else if (sUpper.includes("PLAN")) this.state.interactionMode = "PLAN";
```

Any message mentioning a plan — "Generating structured engineering plan" — claims PLAN mode for a
task that is in AGENT mode. It is guarded behind `modeResolved`, so today it only fires for a
runtime that never sends `task.mode_resolved`; the guard is the only thing standing between the
product and a wrong mode badge.

**A provider failure, by the word "provider".** The benchmark classified a failed run as
`provider_error` when the error text contained "provider". NVIDIA's message is
`NVIDIA API Error: 504`, which contains no such word, so every run a gateway killed was filed as
`grader_failed_other`. Three of the first four failures in B0 landed there, which makes the class
distribution useless exactly where it is supposed to be informative. A repair budget exhausted at
`REPAIR_TIMEOUT` landed in the same bucket for the same reason.

**The agent state, by the wording of a log line.** `agent.status` carried one field, `status`,
which is the sentence the runtime writes for its log: "Executing tools...", "Observing results".
The reducer recovered the state by uppercasing that sentence and testing it against the state
machine's names. It matched almost never, because almost every transition passes a message, so the
header said "Running" for the whole of every task, and the same sentences were appended to the
activity stream as though they were events.

The shape is identical each time. The producer holds a typed value, renders it into English for a
human, and publishes only the English. The consumer needs the value back, and the only thing it
has is the prose.

## Options

**1. Better patterns.** Word boundaries instead of `includes`, a regex per case, a list of known
NVIDIA error strings. Rejected. It is the same bet placed more carefully: the producer is still
free to reword its message, and nothing tells it that a consumer is depending on the wording. The
benchmark had already been through one round of this — `\bASK\b` in the mode inference is the
scar — and the next provider's phrasing breaks it again.

**2. A parsing helper shared by every consumer.** Rejected. It centralises the parsing but not the
dependency: the producer still does not know the contract exists, and a single shared parser makes
one reworded message wrong in every consumer at once instead of one.

**3. The producer publishes the value it already has, in its own field.** Chosen.

## Choice

**An event carries its meaning in a typed field. No consumer recovers meaning by parsing a string
meant for display.**

In practice:

- A display string may be added, changed or translated freely. Nothing may depend on its content.
- When a consumer needs to branch on something, the producer publishes that something as its own
  field with its own type. `agent.status` gained `state`; `tool.started`/`tool.completed` gained
  `target`; `change.created` gained `additions`/`deletions`; a provider failure is counted in
  `providerFailures` by cause.
- A field that exists for a machine is validated against a known set on arrival, and an unknown
  value is ignored rather than guessed at. The reducer checks `state` against `KNOWN_AGENT_STATES`
  and falls back to showing the message as a live label — which is display, not a decision.
- Where a legacy producer genuinely cannot be changed, the parsing lives in one clearly marked
  compatibility branch that runs only when the typed field is absent, and it is a fallback, never
  the primary path.

## Reasoning

**The producer already has the value.** In all three cases the typed value existed one line above
the string that was published: the state machine knew it was in `TOOL_CALLING`, the request pipeline
knew the response was a 504, the kernel knew the mode was `AGENT`. Nothing had to be inferred;
something only had to be sent. That is what makes this rule cheap — it is almost never a question
of computing new information.

**A wrong answer from parsing is silent.** A missing field is a `undefined` a consumer can check
and a type system can see. A message that fails to match a pattern produces a confident wrong
answer instead: "Running" for every task, `grader_failed_other` for every gateway failure. The
failure mode is the reason this is worth a rule rather than a code review note.

**The cost of the string contract is paid by whoever rewords the message**, who has no way of
knowing they are about to break a consumer, possibly in another package, possibly in the
measurement harness. Nothing in typecheck, lint or the test suite reports it. Both of the older
instances were found by a person noticing a number looked wrong.

**The correction has to be applicable after the fact.** `refineFailureClass` reads the stored
`providerFailures` counters at report time, so a run measured before the classifier was corrected
can still be read correctly. That is only possible because the record holds the typed cause rather
than only the sentence — a journal of prose could not have been re-read.

## Consequences

- Adding a consumer-visible distinction means adding a field to the event, which means a protocol
  change and a rebuild of `@comu/protocol` before consumers typecheck. That is the intended
  friction: it puts the change in front of the producer's author.
- Event payloads grow. `target` is bounded to 160 characters for exactly this reason — a typed
  field is not a licence to publish the whole argument object, which would put file content into
  the stream.
- The remaining legacy parsers are marked and load-bearing only for old runtimes:
  `task_session_store.ts` (mode by substring, behind `modeResolved`) and the reducer's
  `upper.startsWith("WAITING")` fallback. Neither may be extended; the next new case gets a field.
- The rule predicts the next instance, which is already in the tree and not yet a defect:
  `OpenAICompatibleProvider` picks a capability profile by testing whether the model id or endpoint
  contains "astra" or "experiential". A model renamed by its vendor silently loses its profile.
  When that one is touched, the profile should be selected from a declared field rather than sniffed
  from a name.

## See also

- `packages/protocol/src/index.ts` — `AgentStatusEvent.state`, `ToolStartedEvent.target`,
  `ChangeCreatedEvent.additions`
- `benchmarks/src/metrics.ts` — `classifyFailure` (the parse) beside `refineFailureClass` (the fix)
- `apps/vscode-extension/src/sessions/task_session_store.ts` — the mode inference, still there
- [0016](0016-the-activity-stream-reports-work-not-state.md) — the interface change that surfaced
  the third instance
- [0009](0009-every-task-ends-with-exactly-one-terminal-event.md) — the same preference for a
  guarantee at the producer over compensation in every client
