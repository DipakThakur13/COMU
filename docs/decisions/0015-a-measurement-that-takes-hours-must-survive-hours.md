# 0015. A measurement that takes hours has to survive hours

Status: accepted
Area: measurement

## Problem

A full benchmark is fifteen fixtures at five repetitions: seventy-five runs against a real provider.
At the observed median that is around seventeen hours sequentially, and each run costs real money
and real provider time.

Anything that takes seventeen hours will be interrupted. A dropped connection, a provider outage, a
closed laptop lid, a crash in the harness, a decision to change something and start again. The first
version wrote its results at the end, so any of those threw away everything measured so far.

Three separate problems follow from the duration, and each has a wrong answer that looks right:

- **Losing the work.** Writing at the end is the natural shape and the worst one.
- **The duration itself.** Seventeen hours is long enough that nobody runs the benchmark, and a
  benchmark nobody runs stops being a baseline.
- **Two runners at once.** Once resuming exists, starting a run is cheap and looks idempotent. It is
  not: three runners were once alive against one journal at the same time, and nothing in the output
  showed it.

## Options

Considered together, because the fixes interact.

**Write at the end, run sequentially, no locking.** The starting point. Rejected on all three
counts.

**Checkpoint to a single result file, rewritten after each run.** Rejected: a crash during the
rewrite loses the whole file, which is the failure being defended against.

**Run concurrently and treat the result as equivalent.** Rejected as false. Concurrency does not
touch correctness — every run gets its own runtime, its own port and its own temporary workspace —
but it certainly touches wall clock, because concurrent runs contend for the provider.

**Append-only journal, a fixed worker pool, and a per-label lock.** Chosen.

## Choice

**An append-only journal, written as each record exists.** One JSON object per line, appended the
moment a run finishes. A crash costs the run in flight and nothing else.

**Keyed by label alone, with no date.** A dated journal would split at midnight, and a resume after
the split would re-measure and re-pay for everything recorded before it. The bug is invisible in the
output — the run simply costs twice as much — and a seventeen-hour run crosses midnight by design.

**Resume by fixture and repetition.** On start, the journal is read and every `fixture#rep` already
present is skipped. The count of reused records is printed, so a resumed run says how much of its
result it did not measure.

**A fixed worker pool, `--concurrency`, default 1.** Jobs are ordered repetition-major rather than
fixture-major, so four workers spread across four different fixtures instead of queueing behind one
fixture's virtual environment.

**The level is recorded on the run and caveated in the report.** Above 1, the report states that
wall clock is an upper bound and says which numbers are unaffected and why.

**A per-label lock holding the pid.** A second runner under the same label is refused with an
explanation. A lock whose holder is no longer alive is taken over silently.

## Reasoning

**Append-only is the only shape that survives its own crash.** There is no partial write that
corrupts an earlier record, and a truncated final line is one unparseable line rather than a lost
file.

**Concurrency is honest about exactly one thing.** Per-run latency stops being a measurement and
becomes an upper bound. Correctness, token counts, peak context and failure classes are unaffected
because nothing is shared between runs — and stating which is which, in the report rather than in
someone's memory, is what makes the number safe to quote later.

**Contention can reach correctness through the timeout, and that is the thing to watch.** A request
waiting behind three others can pass `modelRequestTimeoutMs`; the task then ends and is recorded as
a failure the agent did not commit. This is the measurement manufacturing its own result, which is
worse than a slow run, so timeouts are counted separately from other provider failures rather than
totalled with them.

**The lock exists because the damage from a second runner is invisible.** The journal stayed well
formed and free of duplicates while three runners shared it. What actually happened was triple the
intended provider load — inflating every duration and manufacturing exactly those timeouts — work
paid for twice, and three processes each poised to write the final result file from its own partial
set of records, last writer winning. Nothing about the output would have prompted anyone to look.

**A stale lock is taken over, not reported.** A guard that routinely demands a file be deleted by
hand trains people to delete it without reading, and then it guards nothing.

## Consequences

- The journal is the real result and the `.json` is a rendering of it. A journal deleted by hand
  cannot be reconstructed.
- Resuming assumes the code has not changed underneath. Records from before a harness change sit in
  the same journal as records after it, so a change to what is measured needs a new label. Records
  written before a field existed default rather than throwing, which is what makes a mixed journal
  readable at all.
- A concurrent run's wall clock cannot be compared with a sequential one's. The concurrency level is
  on the run for exactly this reason.
- The lock is per label, so two different labels can run at once — and will contend with each other
  in a way nothing records. Running two labels simultaneously is not a supported measurement.

## See also

- `benchmarks/src/report.ts` — `appendRecord`, `readJournal`, `journalStem`, `acquireRunLock`
- `benchmarks/src/cli.ts` — the worker pool and the resume
- [0006](0006-benchmark-grading-contract.md) — what the runs are graded against
