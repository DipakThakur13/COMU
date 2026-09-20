# 0011. How many times a request is retried depends on why it failed

Status: accepted
Area: model requests

## Problem

Model providers fail in several ways and the retry loop treated them as one. Every retryable error
got the same `maxAttempts`, and `maxAttempts` was three.

Two of those failures do not earn three attempts, and one of them is actively harmful:

**A timeout.** The request has already shown it will not finish inside the window. Retrying spends
another full window on the same request, and then a third. With a 120-second timeout, a task that
was going to fail took six minutes to say so, and the information arrived three windows after it
was known. Meanwhile the user watched a panel that looked busy.

**A gateway refusal.** 502, 503 and 504 are the provider's front door giving up rather than the
model declining. They are worth one retry. They also correlate with request size, so a request large
enough to provoke one tends to provoke it again, and the third attempt is mostly more waiting.

And some failures should never be retried at all. A bad key does not become a good key, and an
invalid request does not become valid; retrying those wastes time on a certainty and, for a
cancellation, actively fights the user who pressed Stop.

Underneath this sits a question the retry loop cannot answer: **is the budget too small, or is the
request wrong?** A blanket retry count assumes the first and responds by trying again. Since
[0010](0010-budgets-are-per-task-and-reported-back.md) the budget is a per-task parameter, so if the
window is genuinely too small the answer is a bigger window — not three attempts at the same wall.

## Options

**1. One retry count for everything.** What existed. Rejected: it spends the most time on the
failure that deserves the least.

**2. A count per provider.** Rejected. The cause varies within a provider far more than between
providers — the same endpoint times out, refuses at the gateway and rejects a key — so the axis is
wrong and it would need maintaining per provider.

**3. Retry nothing; surface every failure immediately.** Genuinely tempting, and rejected because a
gateway refusal is often transient and a single retry converts a visible failure into a working task
at no real cost.

**4. Attempts as a function of the error class.** Chosen.

## Choice

Two functions, deliberately separate.

`isRetryable` answers whether trying again could possibly help. Authentication, authorization,
invalid request and cancellation are no; an aborted request is no. Everything else is yes.

`maxAttemptsFor` answers how many attempts the failure earns:

| Error | Attempts | Why |
|---|---|---|
| `ProviderTimeoutError` | 1 | It already failed to finish in a full window |
| `ProviderUnavailableError` (502, 503, 504) | 2 | Often transient, but correlated with request size |
| anything else retryable | `maxAttempts` | No reason to treat it specially |

Providers map 502, 503 and 504 onto `ProviderUnavailableError` so the classification happens once, at
the edge, rather than by matching status codes in the retry loop.

A timeout is emitted as `model_request.timed_out` and everything else as `model_request.failed`,
which keeps the distinction visible to anything watching the stream.

## Reasoning

**"Could this help" and "how much is it worth" are different questions.** Collapsing them into a
single number is what produced the original behaviour. Keeping them apart means a new error class
has to answer both, and the answers are written where a reader can see them.

**One attempt is not the same as not retrying.** A timeout still runs once; the decision is only
that it does not run again. That distinction keeps the behaviour explainable and means a timeout is
never silently treated as fatal.

**The classification belongs in the provider, not the retry loop.** A retry loop matching on HTTP
status codes would need every provider's dialect. Mapping at the edge means the loop reasons about
error types, and a new provider joins by mapping its own failures.

**Retries interact with the budget, so the two must be decided together.** Three attempts at a
two-minute timeout is a six-minute failure inside a five-minute execution budget — the task dies of
its own retry policy. Making the timeout settable per task without also cutting timeout retries
would have left that intact.

## Consequences

- A task hitting the model request timeout now fails roughly three times sooner. That is the
  intent; anything that genuinely needs longer raises `modelRequestTimeoutMs` for its own task.
- A provider that reports an overload as something other than 502, 503 or 504 gets the generic count
  until it is mapped. Its gateway rate reads zero, which is why the benchmark counts the four causes
  separately rather than trusting a single total.
- `maxAttempts` still exists and still applies to everything unclassified, so a future error class
  gets the old behaviour by default.

## See also

- `packages/model-core/src/manager.ts` — `isRetryable`, `maxAttemptsFor`
- `providers/nvidia/src/index.ts`, `packages/model-core/src/openai_provider.ts` — the mapping
- [0010](0010-budgets-are-per-task-and-reported-back.md) — the budget this policy assumes is settable
