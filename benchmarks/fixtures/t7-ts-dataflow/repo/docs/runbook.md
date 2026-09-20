# Runbook

## Knobs

| Setting            | Default | Notes                                              |
| ------------------ | ------- | -------------------------------------------------- |
| `bufferSlots`      | 4096    | raising it costs memory, lowering it costs rows     |
| `flushEvery`       | 1000    | how often the indexer seals                         |
| `watchIntervalMs`  | 2000    | zero means a single pass and exit                   |
| `quarantineLimit`  | 500     | after this the run aborts                           |

## "The row is in the file but the query says no"

Nine times out of ten the answer is that the run has not written enough rows yet. Check the
`segments.sealed` counter before looking at anything else. If the counter is moving and the row is
still absent, check the quarantine log, then the drop counter.

## "The timestamps look wrong by an hour"

They are not wrong. Read `src/normalise/timestamps.ts` and then `src/query/reader.ts` together
before raising a ticket; the two are supposed to cancel out.

## Backfills

Run with `watchIntervalMs=0`. Backfills are the one case where the drop counter should be zero,
because the source cannot outrun the pipeline when it is reading a single file.
