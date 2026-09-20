# 0007. A stand-in that does not behave like the thing it replaces tests nothing

Status: accepted
Area: testing practice

## Problem

This is not a decision about a component. It is the lesson one phase of work kept teaching, written
down because it cost several hours and will cost them again.

Building the benchmark produced four defects in the instrument itself. Every one passed its own
tests. Every one was caught only by the thing it would have corrupted, and in two cases only after
it had already produced a confident wrong answer:

- **The JUnit parser** read the `name` attribute with a pattern that also matched the tail of
  `classname`. Node emits `name` first, so TypeScript parsed correctly; pytest emits `classname`
  first, so every Python test came back identified by its module and no required test ever matched.
  One ecosystem was silently graded wrong while the other proved the parser worked.
- **The credential guard** matched `sk-` without a leading boundary, which also matches inside every
  task id COMU generates. It refused to write any result at all.
- **The workspace lister** skipped any directory named `reports` at every depth, not just the root
  where the grader writes. A fixture with a real `src/reports/` would have been invisible to the
  pristine check, to change detection and to the forbidden-symbol scan, so a half-finished refactor
  would have been graded complete.
- **The stand-in model** returned its whole answer in one lump. Real providers stream, and the
  harness collects the assistant's prose from token deltas, so the self test graded an empty answer
  and reported zero for a fixture that was correct.

Alongside those, three separate regex escapes were destroyed by generating code through a patch
script: `(\\*)` became `(\*)`, a `\n` became a real newline inside a string literal, and a `\b`
became a literal backspace byte. Each produced a program that ran.

## The pattern

Every one of these is the same shape. Something stood in for something else and differed in a
detail that happened to matter:

- a parser tested against one emitter's attribute order, standing in for both
- a guard tested against a key, standing in for every string that looks like one
- a lister tested at the root, standing in for the whole tree
- a fake model that answers, standing in for one that streams
- a generated file, standing in for the bytes intended

None failed loudly. All produced a confident answer that was wrong, which is worse than an error,
because an error stops you and a wrong answer gets acted on.

## What follows from it

**Exercise a double against the real thing's observable behaviour, not its interface.** The
stand-in model now streams, because streaming is how the real provider delivers text and the harness
depends on that. A double that satisfies the type and not the behaviour tests the type.

**Test a parser against real captured output from every producer**, not a hand-written sample. The
JUnit tests now assert both attribute orders explicitly, because a sample written by the same person
who wrote the parser shares its assumptions.

**Write backslashes with the editing tools, never through a generating script.** Three escape levels
were lost this way. When a probe reports a surprising defect in escaping or quoting, verify the
probe first: one of those three "findings" was an hour spent diagnosing a defect that did not exist.

**When an instrument reports a defect, ask whether the instrument is the defect.** That question
found two of the four, and asking it late is what made the other two expensive.

**Make the double's divergence impossible rather than remembered.** Where a stand-in cannot
reasonably match, say so where it is defined, and prefer driving the real path: the benchmark starts
a real runtime over a real socket rather than calling the orchestrator directly, precisely so the
gap between what is measured and what ships stays small.

## Consequences

- Test doubles carry a comment stating what they stand in for and where they deliberately differ.
- A new ecosystem in the benchmark means new captured output for the parser tests, not another
  hand-written sample.
- This record is not enforceable by a test, which is the point: it is the judgement that decides
  what to test, not a rule a test can apply.

## See also

- [0005](0005-development-export-condition.md) — the same shape in resolution: a built artifact standing in for source
- [0006](0006-benchmark-grading-contract.md) — why the benchmark refuses to consult the thing it measures
