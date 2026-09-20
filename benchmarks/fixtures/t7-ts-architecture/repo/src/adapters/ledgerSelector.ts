import type { Config } from "../boot/config.ts";
import type { Clock } from "../ports/clock.ts";
import type { Ledger } from "../ports/ledger.ts";
import type { Logger } from "../telemetry/logger.ts";
import { MemoryLedger } from "./memoryLedger.ts";
import { RetryingLedger } from "./retryingLedger.ts";
import { SqlLedger, nullDriver } from "./sqlLedger.ts";

/**
 * Picks the storage implementation and hides the choice from everyone above.
 *
 * Two conditions send traffic to the in-memory store, not one: an empty DSN, which is the
 * obvious case, and `region === "sandbox"`, which holds even when a perfectly good DSN is set.
 * The sandbox rule was added after a load test wrote a million rows into the shared carrier
 * database. Whichever store wins, it is wrapped in RetryingLedger before it leaves here, so
 * nothing above `adapters/` ever holds a bare store.
 */
export function selectLedger(config: Config, _clock: Clock, logger: Logger): Ledger {
  const useSql = config.ledgerDsn !== "" && config.region !== "sandbox";
  const chosen: Ledger = useSql
    ? new SqlLedger(nullDriver(), logger, config.tariffTable)
    : new MemoryLedger();

  logger.info("ledger_selected", { kind: chosen.kind, region: config.region, dsn: config.ledgerDsn !== "" });
  return new RetryingLedger(chosen, config.maxRetries, logger);
}
