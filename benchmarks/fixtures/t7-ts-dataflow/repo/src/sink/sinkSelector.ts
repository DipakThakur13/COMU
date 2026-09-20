import type { Settings } from "../config/settings.ts";
import type { Clock } from "../util/clock.ts";
import type { Logger } from "../util/logger.ts";
import type { Stage } from "../pipeline/stage.ts";
import { ColumnStore } from "./columnStore.ts";
import { WriteAheadLog } from "./writeAheadLog.ts";
import { Indexer } from "../query/indexer.ts";
import { attachStore } from "../query/reader.ts";
import { validateQuote } from "../schema/validate.ts";

export interface Sink {
  readonly kind: string;
  accept(record: Record<string, unknown>): { stored: boolean; reason?: string };
  close(): void;
}

/**
 * Builds the durable sink and, as a side effect, publishes the store to the query layer.
 *
 * `attachStore` is what makes src/query/reader.ts able to answer at all. Because the sector
 * enrichment stage reads through that reader, the pipeline cannot be built before the sink is,
 * which is the real reason selectSink is called first in src/pipeline/build.ts.
 */
export function selectSink(settings: Settings, clock: Clock, logger: Logger): Sink {
  const store = new ColumnStore(settings.segmentDir);
  const wal = new WriteAheadLog(settings.walPath, clock);
  const indexer = new Indexer(store, wal, clock, settings.flushEvery, logger);

  attachStore(store, settings.profile);

  return {
    kind: "wal+segments",
    accept(record) {
      const verdict = validateQuote(record);
      if (!verdict.ok) return { stored: false, reason: verdict.reason };

      wal.append(verdict.quote);
      const fresh = store.append(verdict.quote);
      indexer.recordWritten();
      return { stored: fresh, reason: fresh ? undefined : "duplicate" };
    },
    close() {
      indexer.sealNow();
    }
  };
}

/** The last stage. Validation lives here, after both enrichment stages have already run. */
export function sinkStage(sink: Sink, settings: Settings, logger: Logger): Stage {
  return {
    name: "sink",
    async apply(record, context) {
      const result = sink.accept(record);
      if (!result.stored && result.reason !== "duplicate") {
        context.quarantine.push({ reason: result.reason ?? "unknown", raw: record });
        if (context.quarantine.length % 100 === 0) {
          logger.warn("quarantine_growing", { count: context.quarantine.length, limit: settings.quarantineLimit });
        }
        return undefined;
      }
      context.bump(result.stored ? "sink.stored" : "sink.duplicate");
      return record;
    }
  };
}
