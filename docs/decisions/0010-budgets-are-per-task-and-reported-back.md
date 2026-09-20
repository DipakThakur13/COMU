# 0010. A budget is a per-task parameter with a ceiling, and the resolved budget is reported back

Status: accepted
Area: runtime limits

## Problem

An agent needs budgets: a cap on steps, on tool calls, on wall clock, on repair attempts, on how
long one model request may take. Without them a confused run costs money forever.

They were constants. One number for every task, compiled in.

Every value in that set is a compromise between two tasks that want opposite things. Five minutes of
wall clock is right for "rename this symbol" and absurd for "port this module and make the suite
pass". A 120-second model request timeout is generous for a small prompt and, against a 550B model
answering a 50,000-token prompt, is shorter than a normal reply — which is how a fixed timeout
turned working runs into failures:

> the request passed 120 seconds, was aborted, was retried, passed 120 seconds again, and the task
> failed. Nothing was wrong with the task.

The benchmark makes this sharper. It has to run tasks that are deliberately harder than a panel
session, and it has to be able to say afterwards what budget produced the numbers. A constant can do
neither.

There is also a floor under the whole question: a budget is not a security boundary. What a task is
*allowed* to do is decided by autonomy and the approval gate ([0002](0002-autonomy-model-and-scope-keys.md)),
not by how many steps it gets. Raising a limit lets a task work longer; it never lets a task do
something it could not already do. That is what makes it safe to expose.

## Options

**1. Keep the constants and pick better numbers.** Rejected. There is no number that suits both a
panel task and a benchmark task, and the last several incidents were all the same shape: a value
that was reasonable for the case it was chosen for.

**2. Environment variables.** Rejected. Process-wide, so two concurrent tasks cannot differ — which
the benchmark needs, since it runs several at once against one build. They are also invisible in the
result: a number in someone's shell does not travel with the measurement it produced.

**3. Per-task limits, unbounded.** Rejected. `maxExecutionTimeMs: 99999999` from a typo or a
careless client wedges the runtime on a task that will never end, and an overridable limit with no
ceiling is not a limit.

**4. Per-task limits, validated against ceilings, echoed back on the task.** Chosen.

## Choice

`POST /v1/tasks` accepts an optional `limits` object. `resolveTaskLimits` merges it over
`DEFAULT_AGENT_LIMITS` and rejects, with a 400 naming the field:

- an unknown key, listing the allowed ones;
- a value that is not a positive integer;
- a value above its ceiling in `MAX_AGENT_LIMITS`, naming the ceiling.

The ceilings are deliberately generous — two hours of execution, 1000 steps, fifteen minutes for one
model request. They are there to stop a typo, not to express a policy.

The task creation response returns the resolved budget, all eight values, whether or not the caller
asked for anything. The benchmark records that object with every run.

`modelRequestTimeoutMs` is the value that forced this and it kept its default of 120 seconds. That
is the right number for a panel, where a request that has not answered in two minutes is usually
stuck. Everything that needs longer — the benchmark, against a 550B model on a large prompt — raises
it for its own tasks instead of raising it for everyone.

## Reasoning

**Validation rejects, it does not clamp.** A silently clamped value is a measurement that lies: the
benchmark would record what it asked for while the runtime used something else, and a whole run's
numbers would be attributed to the wrong budget. A 400 naming the field also turns a typo into an
immediate, readable error instead of a task that behaves oddly for reasons nobody can see.

**Unknown keys are an error, not ignored.** `maxToolcalls` is a plausible mistake. Ignoring it would
run the task under the default while the caller believed otherwise — the same lie as clamping, and
harder to notice because nothing appears wrong.

**The resolved budget is part of the result, not part of the request.** Anyone reading a benchmark
record can see the budget that produced it without trusting the command line that launched it, which
matters because the command line is not in the record and the record outlives the shell.

**The ceilings are not a security control and are not written as one.** Saying so in the code stops
the next person from reading them as one and either tightening them until legitimate work fails, or
assuming the approval gate is unnecessary because limits exist.

## Consequences

- Eight names are now API surface. Renaming one is a breaking change for any client that sets it,
  and the error message enumerating them means a rename shows up as a rejected task rather than a
  silent default.
- A task can legitimately run for two hours. Nothing else in the runtime assumes tasks are short,
  but anything added that does will be wrong for a task at the ceiling.
- The defaults still have to be right for the panel, because that is what a caller who passes
  nothing gets. Tuning them for the benchmark's convenience would be tuning the product for a
  non-user.

## See also

- `apps/agent-runtime/src/server.ts` — `DEFAULT_AGENT_LIMITS`, `MAX_AGENT_LIMITS`, `resolveTaskLimits`
- [0011](0011-retry-depends-on-why-the-request-failed.md) — what happens when a request hits the
  model request timeout
- [0006](0006-benchmark-grading-contract.md) — why a measurement has to carry its own conditions
