import type { Config } from "./config.ts";
import { selectLedger } from "../adapters/ledgerSelector.ts";
import { SystemClock } from "../adapters/systemClock.ts";
import { ReadThroughCache } from "../cache/readThroughCache.ts";
import { Outbox } from "../queue/outbox.ts";
import { DispatchService } from "../services/dispatch.ts";
import { IntakeService } from "../services/intake.ts";
import { PricingService } from "../services/pricing.ts";
import { createLogger, type Logger } from "../telemetry/logger.ts";
import { Metrics } from "../telemetry/metrics.ts";
import type { Clock } from "../ports/clock.ts";
import type { Ledger } from "../ports/ledger.ts";

// Imported for effect only. Each of these calls registerRoute() as it loads; dropping an import
// silently removes the endpoint, which is why they are listed explicitly rather than globbed.
import "../http/routes/consignments.ts";
import "../http/routes/tariffs.ts";
import "../http/routes/health.ts";

export interface Container {
  config: Config;
  clock: Clock;
  logger: Logger;
  metrics: Metrics;
  ledger: Ledger;
  reads: ReadThroughCache;
  pricing: PricingService;
  outbox: Outbox;
  intake: IntakeService;
  dispatch: DispatchService;
}

let current: Container | undefined;

/**
 * The composition root. The only place in the process where a concrete class meets a port.
 */
export function buildContainer(config: Config): Container {
  const clock = new SystemClock();
  const logger = createLogger(config.region);
  const metrics = new Metrics();

  const ledger = selectLedger(config, clock, logger);
  const reads = new ReadThroughCache(ledger, clock, config.cacheTtlMs, metrics);
  const pricing = new PricingService(config.tariffTable);
  const outbox = new Outbox(clock, metrics, logger);
  const dispatch = new DispatchService(ledger, pricing, metrics, logger);
  const intake = new IntakeService(outbox, reads, clock, metrics);

  current = { config, clock, logger, metrics, ledger, reads, pricing, outbox, intake, dispatch };
  return current;
}

/**
 * Route modules are loaded before the container exists, so they cannot be handed their
 * dependencies as arguments. They reach back through this instead.
 */
export function container(): Container {
  if (!current) throw new Error("container() called before buildContainer()");
  return current;
}
