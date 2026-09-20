# 0006. The benchmark grades the workspace, never COMU's own report

Status: accepted
Area: measurement

## Problem

Phase 2 changes context handling and planning. Neither can be judged by looking: "did compaction
help" and "is the new planner better" are questions about quality across a distribution of tasks,
and a change that improves three tasks and harms five feels like progress while being a regression.

The repository already had a 27-scenario campaign reporting a 100% pass rate and concluding
"production ready". Every model turn in it was a canned response written by the test. A puppet
cannot fail the scenario it was scripted to pass, so the number measured the orchestrator's wiring
and said nothing about the agent, while reading exactly like a quality claim.

So the benchmark has to answer two things the existing suite could not: whether work was actually
done, and whether COMU's own account of it can be believed.

## Options

**1. Trust the task status.** Read `task.completed` and count. Rejected outright: self-reported
success is the single thing a benchmark exists to check, and COMU's completion gate is itself under
measurement in this phase.

**2. Compare the diff against the golden solution.** Rejected: it grades the shape of the answer
rather than the answer. A correct fix that differs from the reference would be marked wrong, which
punishes exactly the behaviour worth having.

**3. A model as judge.** Rejected for the workspace tiers and for the prose tier. It makes the
benchmark's verdict depend on a model, which is the thing being measured, and it adds a second
inference per run whose failures are indistinguishable from the agent's.

**4. Run the code.** Chosen.

## Choice

Every grader reaches its own verdict by executing the fixture's tests in the finished workspace. No
grader reads COMU's status, its final message, or any event it emitted. Three kinds:

| Grader | Verdict from |
|---|---|
| tests | the suite exits zero, the required tests pass, and nothing that passed before now fails |
| refactor | the above, plus the old symbol is gone and the new one is where it should be |
| rubric | the answer contains each required fact, matched by any of several patterns |

Both ecosystems report through JUnit XML, which Node's test runner and pytest emit natively, so one
parser serves both and the fixtures need no test framework installed.

Grader-only tests are withheld until the workspace is sealed. Two assertions guard that: the
starting workspace must be exactly the pinned tree, and no file may sit where a withheld test
belongs, checked before and after the run.

The disagreement between the grader and COMU is itself recorded, in both directions:

- **False completion**: COMU reported success, the grader disagrees.
- **False failure**: COMU reported failure, the work was correct.

Results are reported per fixture as k of n. There is no pooled rate anywhere.

## Reasoning

**Independence is the product.** A benchmark that consults the thing under test has no authority.
Running the code is the only verdict that cannot be talked out of.

**Withholding tests is what makes a fixture measure the requirement** rather than the example. A
fix that special-cases the one visible case passes a naive grader and fails a real user; the
withheld tests are the difference. They arrive only after the workspace is sealed so the agent
cannot write against the specific assertions.

**The leakage assertions are path and identity checks, not content matching.** An agent that
succeeds legitimately reproduces the golden solution, so flagging identical content as leakage would
mark every success as cheating. What must be impossible is the answer being *present* before the
agent starts, and that is checked by requiring the starting tree to equal the pinned sources exactly.

**Both directions of disagreement matter and they are not the same failure.** A false completion
destroys trust and is the worst outcome the product has. A false failure wastes work and usually
points at verification or the completion gate rather than the agent. Folding them into one accuracy
number would hide which one moved.

**A pooled rate averages a fixture that always works with one that never does and describes
neither.** Succeeding three times in five is a different product from five in five, and only the
per-fixture form shows it. The threshold for calling a change real was written down before any
result existed, so it cannot be chosen afterwards to suit a number.

**Deterministic rubrics over a judge** keeps the onboarding tier's verdict reproducible. The agent's
answer is recorded verbatim so a human can still read it and disagree, without the score depending
on that reading.

## Consequences

- A fixture is only as good as its withheld tests. Authoring one means thinking about which wrong
  fix looks right, which is real work and is where the value is.
- The grader cannot credit partial progress. A task is correct or it is not, and the failure class
  carries the nuance.
- Fixtures must run without third-party dependencies, which constrains what they can be about.
- The scripted campaign remains, renamed to say what it is: a plumbing test, not a benchmark.

## See also

- `benchmarks/README.md` and `benchmarks/src/graders.ts`
- `benchmarks/tests/grader_cases.test.ts` — the grader's own tests, against hand-worked verdicts
- [0007](0007-a-stand-in-must-behave-like-the-thing-it-replaces.md)
