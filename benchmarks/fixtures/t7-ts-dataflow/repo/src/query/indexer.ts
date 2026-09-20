import type { ColumnStore } from "../sink/columnStore.ts";
import type { WriteAheadLog } from "../sink/writeAheadLog.ts";
import type { Clock } from "../util/clock.ts";
import type { Logger } from "../util/logger.ts";

/**
 * Decides when the staging segment becomes visible.
 *
 * It counts writes and seals every `flushEvery` of them, which by default is 1000. Until a seal
 * happens the rows exist in the write ahead log and in memory but cannot be read by anything,
 * including the sector enrichment stage. On a quiet feed this is the difference between a row
 * being ingested and a row being queryable, and there is no timer that forces the issue.
 */
export class Indexer {
  private since = 0;
  private sealedCount = 0;

  constructor(
    private readonly store: ColumnStore,
    private readonly wal: WriteAheadLog,
    private readonly clock: Clock,
    private readonly flushEvery: number,
    private readonly logger: Logger
  ) {}

  recordWritten(): void {
    this.since += 1;
    if (this.since >= this.flushEvery) this.sealNow();
  }

  sealNow(): void {
    const segment = this.store.seal(this.clock.now().toISOString());
    this.since = 0;
    if (!segment) return;
    this.wal.truncate();
    this.sealedCount += 1;
    this.logger.info("segment_sealed", { id: segment.id, rows: segment.rows.length });
  }

  segmentsSealed(): number {
    return this.sealedCount;
  }
}
