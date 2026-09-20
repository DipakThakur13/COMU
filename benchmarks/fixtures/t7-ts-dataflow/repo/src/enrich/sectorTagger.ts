import type { Stage } from "../pipeline/stage.ts";
import { lastKnownSector } from "../query/reader.ts";

const STATIC_SECTORS: Record<string, string> = {
  GB00BH4HKS39: "telecoms",
  GB0007980591: "energy",
  GB0005405286: "financials",
  DE0007164600: "technology"
};

/**
 * Tags the record with a sector.
 *
 * The awkward part is the fallback. When the static table has no entry, this stage asks the query
 * layer for the sector the last sealed segment recorded for the same ISIN, which means an
 * ingestion stage imports src/query/reader.ts and reads back out of the store it is currently
 * writing into. The layering is therefore not one-directional: enrich depends on query, and query
 * depends on sink, and sink is downstream of enrich. It was the cheapest way to keep a newly
 * listed instrument tagged consistently across a restart, and nobody has untangled it since.
 */
export function sectorStage(): Stage {
  return {
    name: "sector",
    async apply(record, context) {
      const isin = String(record.isin ?? "");
      const known = STATIC_SECTORS[isin];
      if (known) {
        context.bump("sector.static");
        return { ...record, sector: known };
      }

      const remembered = await lastKnownSector(isin);
      context.bump(remembered ? "sector.recalled" : "sector.unknown");
      return { ...record, sector: remembered ?? "unclassified" };
    }
  };
}
