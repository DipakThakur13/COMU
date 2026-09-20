import type { Settings } from "../config/settings.ts";
import type { Clock } from "../util/clock.ts";
import type { Logger } from "../util/logger.ts";
import type { Stage } from "./stage.ts";
import { fieldMapStage } from "../normalise/fieldMap.ts";
import { currencyStage } from "../normalise/currency.ts";
import { timestampStage } from "../normalise/timestamps.ts";
import { instrumentStage } from "../enrich/instrumentLookup.ts";
import { sectorStage } from "../enrich/sectorTagger.ts";
import { selectSink, sinkStage } from "../sink/sinkSelector.ts";

/**
 * Assembles the stage list. The order here is the whole contract of the pipeline.
 *
 * Note where the sink stage sits: last, after both enrichment stages. Validation lives inside the
 * sink stage, so a record that will be quarantined has already paid for an instrument lookup and
 * a sector tag by the time anyone checks whether it is a quote at all.
 */
export function buildPipeline(settings: Settings, clock: Clock, logger: Logger): Stage[] {
  const sink = selectSink(settings, clock, logger);

  return [
    fieldMapStage(settings.profile),
    currencyStage(settings.profile),
    timestampStage(settings.profile),
    instrumentStage(),
    sectorStage(),
    sinkStage(sink, settings, logger)
  ];
}
