# 0003. Every way an approval can end resolves to approved or denied, never nothing

Status: accepted
Area: approval

## Problem

A tool call under `ask` autonomy stops and waits for a human. That wait can end in more ways than
"they clicked a button":

- Nobody is watching. The task was started from the API, or the panel was never opened, or the user
  closed the window. There is no one to ask.
- The panel is attached but the user walks away. The request sits unanswered indefinitely.
- The task is cancelled while an approval is pending.
- The panel has not subscribed to the event stream yet. The panel subscribes just after task
  creation, so the very first approval of a run can arrive before anyone is listening, even though
  a human is right there.
- The runtime has no interaction channel at all.

The original code awaited a promise that only the user could settle. Every one of these cases
hung the task forever, holding its resources, with the panel showing a spinner and no explanation.
A hung task is the worst outcome available: it is indistinguishable from slow work, so nobody
investigates.

There is also a design trap. Once you accept that a wait must be bounded, the obvious next question
is what happens at the boundary, and "proceed" is an easy answer to reach for because it keeps
tasks moving.

## Options

**1. Wait forever.** What existed. Rejected: it is not a decision, it is the absence of one, and it
converts an unattended run into a stuck process.

**2. Bounded wait, then approve.** Rejected, firmly. It makes the timeout the approval mechanism:
an attacker, or an unlucky sequence of events, gets a write by ensuring nobody answers. It also
inverts what the user asked for. Choosing `ask` says "do not do this without me", and timing out
into approval does exactly the thing they asked to be consulted about, in the one circumstance
where they are demonstrably not present.

**3. Bounded wait, then deny, but no headless detection.** Better, and still bad in practice. An
unattended run under `ask` would stall for the full timeout on every single approval before
failing. A task with twenty writes and a sixty-second timeout takes twenty minutes to get nowhere.

**4. Bounded wait that resolves to denied, plus explicit detection of the no-human case, with a
grace period for the panel to attach.** Chosen.

## Choice

`ApprovalGate.decide` always returns a `GateDecision`. It never returns nothing, and every path
emits an `approval.decided` event carrying the reason:

| Reason | When |
|---|---|
| `SESSION_GRANT` | A grant from [0002](0002-autonomy-model-and-scope-keys.md) already covers this call |
| `APPROVED` | The user approved once |
| `APPROVED_SESSION` | The user approved and granted a scope |
| `DENIED` | The user declined |
| `TIMEOUT` | The bounded wait elapsed with no answer. **Denied.** |
| `NO_HUMAN_OBSERVER` | No event stream subscriber attached within the grace period. **Denied.** |
| `NO_INTERACTION_CHANNEL` | This runtime cannot ask anyone. **Denied.** |

Before asking, the gate checks whether a human can see the task, via a `hasHumanObserver` callback.
If not, it polls for up to `observerGraceMs` to let a just-created panel subscribe. If nobody
attaches, the call is denied as `NO_HUMAN_OBSERVER` with a message naming both remedies: attach the
panel, or run with autonomy `auto` if no supervision is wanted.

That headless verdict is sticky per task, and only in the headless direction. A task judged
headless does not pay the grace wait again on the next approval. A task that has an observer is
re-checked each time, because the user can close the panel mid-run.

Cancellation during the wait aborts it rather than resolving it.

The card shows the countdown and says in words that expiry means denial, so the deadline is visible
before it matters rather than explained afterwards.

## Reasoning

**Expiry as denial is the only direction that preserves what the setting means.** `ask` is a
statement about absence: *if I am not here, do not do it*. A timeout is evidence of exactly that
absence. Approving on timeout would use the strongest evidence that the user is away as the trigger
for acting without them.

**Denial is recoverable and approval is not.** A wrongly denied write fails the task with a clear
reason, and the user retries. A wrongly approved write has already happened. The asymmetry is not
close, so the default falls to the recoverable side.

**Detecting "nobody is home" is different from waiting for silence**, and conflating them is what
makes option 3 useless. Waiting measures elapsed time; the observer check answers the actual
question, and answers it in milliseconds when the answer is no. The timeout then covers only the
case the observer check cannot: a human who is present but not responding.

**The grace period exists because of a real race, not as a fudge factor.** The panel subscribes to
the event stream after the task is created, so a task that requests approval immediately can beat
its own audience. Without the grace window the first approval of an otherwise perfectly supervised
run would be denied. The window is short and bounded, and cancellation interrupts it.

**Stickiness is what keeps the headless path fast**, and it is deliberately one-directional.
Caching "headless" avoids re-waiting the grace period on every call. Caching "has an observer" would
be wrong, because the panel can close at any moment, so that side is re-checked every time.

**Recording every outcome as the same event type is what makes this auditable.** An automatic
denial is a decision and appears in the journal alongside the human ones. "The task failed and I
never saw a prompt" has an answer with a reason code attached.

**Saying it on the card is part of the design, not documentation.** A countdown with no stated
consequence reads as "hurry up". A countdown that says expiry means denied tells the user what
their inaction will do, which is the only way inaction can be treated as a choice.

## Consequences

- Unattended `ask` runs fail fast and clearly, and the message says how to fix it. This is intended:
  the fix is to choose `auto` deliberately.
- `hasHumanObserver` is a real dependency of the gate. A host that does not supply it loses headless
  detection and falls back to the timeout.
- Callers must handle a denial as a normal outcome of a tool call, not an exception.
- The timeout is a bound on human attention, so it is configurable per runtime rather than fixed.

## See also

- `packages/agent-core/src/approval/approval_gate.ts` — `decide`, `waitForObserver`
- `packages/agent-core/src/interaction_manager.ts` — the bounded wait
- [0002](0002-autonomy-model-and-scope-keys.md) — what a grant covers
