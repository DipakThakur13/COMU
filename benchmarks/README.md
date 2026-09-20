# COMU benchmark

Measures how well COMU does real software engineering tasks, against a real model, graded on the
workspace it leaves behind.

This is the only thing in the repository that can answer "did that change make COMU better". The
scripted campaign under `apps/agent-runtime/tests/scripted_plumbing_campaign.test.ts` proves the
orchestrator is wired correctly under a canned model; it cannot say anything about quality, because
no decision in it was made by a model.

## What it does

For each fixture, the harness copies a pinned source tree into a temporary directory, makes it a git
repository, starts the real runtime over loopback HTTP, runs one task, and then grades the resulting
workspace by running its tests itself.

The grader never reads COMU's own status. It reaches its own verdict and then compares, because the
disagreement is the interesting number: a task COMU reports as complete that the grader fails is the
most dangerous outcome this product has.

## Running it

A real API key is required. The harness will not substitute a small local model, because that
measures the model rather than COMU.

```bash
export NVIDIA_API_KEY=...            # or EXPERIENTIAL_API_KEY / OPENAI_API_KEY
pnpm bench --label B0 --reps 5
pnpm bench --label smoke --tier T1 --reps 1
```

Without a key, everything except the model call can still be exercised:

```bash
pnpm bench:selftest
```

That runs the whole harness against a scripted model that edits files deterministically. It proves
the fixtures, the graders, the metric collection and the failure taxonomy work. It is a test of the
instrument, not a measurement of the agent, and it refuses to write a result file.

## Layout

| Path | Contents |
|---|---|
| `fixtures/<id>/task.json` | prompt, tier, model settings, budget, grader spec |
| `fixtures/<id>/repo/` | the source tree, copied fresh for every run |
| `fixtures/<id>/golden/` | reference solution, never visible to the agent |
| `fixtures/<id>/withheld/` | grader-only tests, never visible to the agent |
| `results/` | committed run records, one JSON per execution |

`golden/` and `withheld/` are siblings of `repo/`, never inside it, and the harness asserts after
every run that neither reached the workspace. A fixture whose answer is readable from the workspace
measures nothing.

## Reading a result

Each run records the grader's verdict, the failure class, tokens, wall clock, tool calls, approvals
and the peak prompt size as a fraction of the model's context window. Peak context is recorded even
when nothing overflowed, so the trend stays visible on a model too large to overflow.

Two metrics deserve naming because they point in opposite directions:

- **False completion**: COMU reported success, the grader disagrees. Trust-destroying.
- **False failure**: COMU reported failure, the grader says the work was correct. Wasteful, and
  usually a verification or completion-gate defect rather than an agent defect.
