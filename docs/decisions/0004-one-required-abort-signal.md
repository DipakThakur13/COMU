# 0004. One required `AbortSignal`, enforced by a conformance suite over the registry

Status: accepted
Area: tools

## Problem

Stop has to stop things. That sounds obvious and was not true.

`ToolContext` carried two cancellation mechanisms: a bespoke `CancellationSignal` interface and an
`AbortSignal`. Both were optional. Tools consulted whichever one the author happened to know about,
or neither. Because both were optional, a tool that ignored cancellation entirely compiled, passed
review and shipped, and nothing distinguished it from a tool that handled cancellation correctly.

The git tools made it concrete. They called the process manager directly rather than through the
command path, so they never received a signal at all. Pressing Stop during a push did not cancel
the push. It completed, and the panel showed a cancelled task next to a commit that was now on the
remote. That is the single irreversible action in the product, and it was the one Stop could not
reach.

Two related problems sit underneath:

- Two mechanisms means every tool author picks, and every reviewer has to notice which was picked.
- Optional means the absence of cancellation handling is invisible. There is nothing to grep for
  and nothing that fails.

## Options

**1. Document the expectation and fix the tools we know about.** Rejected. It fixes today's tools
and not tomorrow's, and the whole failure mode is that non-compliance is silent. A convention that
nothing checks is a convention that decays.

**2. Keep both mechanisms, make one preferred.** Rejected: it adds a rule without removing the
thing the rule is about. Both code paths still exist and both still work.

**3. Keep `AbortSignal` optional but add a lint rule.** Rejected. A lint rule can see that a tool
never mentions the signal; it cannot see that a tool mentions it and gets it wrong, which is the
more common defect. It also cannot check a tool's actual behaviour under an aborted signal.

**4. One required `AbortSignal`, delete the alternative, and test conformance over the live
registry.** Chosen.

## Choice

`ToolContext.abortSignal` is a required `AbortSignal`. The `CancellationSignal` interface is
deleted, not deprecated. There is no second way to cancel and no way to construct a context without
one, so a tool cannot fail to receive a signal, only fail to honour it.

Shared helpers in `packages/tool-core/src/cancellation.ts` — `throwIfAborted`, `abortPromise`,
`raceAbort` — give the common shapes one implementation each.

Git tools go through `GitRunner`, which evaluates `CommandPolicy` with `source: "GIT"` and passes
the context's signal into the process manager. There is now one command path, and cancellation is a
property of the path rather than of each caller's diligence.

Conformance is a test, not a convention. `apps/agent-runtime/tests/tool_conformance.test.ts`
iterates `createToolRegistry().getAll()` and asserts of **every** registered tool that it refuses an
already-aborted signal promptly, and that it writes nothing to the workspace when it does. The
runtime exports the same factory the product uses, so the suite covers exactly what ships.

## Reasoning

**Required is the whole point.** Optional cancellation makes the correct and incorrect cases look
identical at the call site and in the type. Making the field required moves "did this tool get a
signal" from a question about the author's care to a question the compiler answers.

**Deleting the alternative was worth the churn.** Two mechanisms is not twice the work, it is a
permanent tax: every author chooses, every reviewer checks the choice, and every bug report starts
by establishing which one was in play. A migration is finite; the tax is not.

**Iterating the registry is what makes this hold for tools that do not exist yet.** A hand-written
list of tools to check is a list someone must remember to update, which is the same failure the
decision is meant to remove — just moved into the test file. Enumerating what is actually registered
means a new tool is covered by existing it. This is the same instinct as
[0001](0001-replicated-reducer-with-sequenced-events.md)'s shared reducer: make the property true by
construction rather than by review.

**The suite asserts behaviour, not shape.** It aborts first and calls second, then checks both that
the tool reported cancellation and that the workspace is untouched. A tool that checks its signal at
the top and then writes anyway fails. Nothing short of running the tool catches that.

**Exporting the real factory is the load-bearing detail.** A test registry assembled in the test
file would drift from the shipped one, and the suite would certify a set of tools nobody runs. It
must be the same object.

**Routing git through the policy fixed the cause rather than the symptom.** The push was
uncancellable because it bypassed the command path, so the fix was to remove the bypass. The
alternative — passing a signal into the git tools' direct process calls — would have left a second
command path in place, with its own policy evaluation, its own output bounds and its own next bug.

## Consequences

- Every caller constructing a `ToolContext` must supply a signal. `neverAborted` exists for the
  genuinely uncancellable cases and its use is a deliberate, visible choice.
- A new tool that ignores cancellation fails CI on the day it is registered, with a message naming
  the tool.
- The conformance suite must be cheap enough to run every time, which bounds what it can assert.
  It checks cancellation and workspace purity, not correctness in general.
- Adding a tool whose abort path is genuinely slow means making it faster, not raising the timeout.

## See also

- `packages/tool-core/src/cancellation.ts` — the shared helpers
- `apps/agent-runtime/tests/tool_conformance.test.ts` — the suite
- `tools/git/src/git_runner.ts` — git on the single command path
- `docs/CANCELLATION_AUDIT.md` — the audit that found this, including findings still open
