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

The credential comes from the environment and only from the environment. Passing one as a command
line argument is refused, because an argument is visible to every other process on the machine and
lands in shell history. Before anything is written, the run record, the event journal and both
result files are checked for the credential and for anything shaped like one; a match aborts the
write rather than redacting it, so a broken path cannot quietly keep producing clean-looking output.

Put the credential in `benchmarks/.env.local`, which is gitignored and read automatically:

```
NVIDIA_API_KEY=...
```

Then no command ever contains it:

```bash
pnpm bench --label B0 --reps 5
pnpm bench --label smoke --tier T1 --reps 1
```

An exported environment variable still wins where one is set, and only variable names are ever
printed, never values.

Do not pass a key inline. A command argument is visible in the process list, lands in shell history,
and ends up in any transcript of the session. The guards in this harness protect what COMU writes;
they cannot reach the shell, and the shell is the only place a key has actually leaked here.

Repetitions: five for B0, B1 and the final run; three for intermediate checks.

Re-running a label resumes it from its journal. The budget is part of the measurement, so a resume
must repeat the original `--limits`: leaving them off means the runtime's defaults, not "the same as
before". A resume whose effective limits differ from the records already in the journal is refused,
with the differences printed. `--accept-mixed-limits` goes ahead anyway and writes a marker into the
journal, and the rendered result then states that its records were measured under more than one
budget.

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

Results are reported per fixture as k of n, never as a pooled rate. Averaging a fixture that always
works with one that never does produces a number true of neither, and hides the distinction the
benchmark exists to show: succeeding three times in five is a different product from five in five.

The agent's final message is recorded verbatim, bounded, on every run. It is there so a human can
judge the quality of an onboarding answer by reading it, while the score stays deterministic and
independent of that reading.

## What counts as a change

Committed before any result exists, so it cannot be chosen afterwards to suit a number.

A delta smaller than the run to run spread is no detected change.

- A fixture moving by one repetition out of five is noise.
- A fixture moving by two or more is a signal for that fixture.
- A suite level claim needs two or more fixtures moving by two or more in the same direction.
- A continuous metric such as tokens or wall clock has moved only when the two runs' ranges do not
  overlap. Medians are reported with their range for exactly this comparison.
- A failure class has moved only when its count changes by more than the number of fixtures that
  moved, since one fixture flipping necessarily moves some class.

Anything smaller is reported as "no detected change", not as an improvement.

## Why the benchmark resolves packages to source

`tsconfig.json` maps every `@comu/*` package to its `src/index.ts`. Without that, the harness
imports the runtime from source while the runtime imports its own dependencies from `dist`, so a
run silently measures whatever was last built rather than the working tree.

That is not hypothetical. A fix to the NVIDIA provider was made, tested and then measured as having
no effect, because the provider package had not been rebuilt. For a benchmark whose entire purpose
is comparing one state of the code against another, resolving to anything but the working tree is a
defect in the instrument.
