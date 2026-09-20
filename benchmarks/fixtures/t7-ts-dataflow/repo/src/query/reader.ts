import type { ColumnStore } from "../sink/columnStore.ts";
import type { Profile } from "../config/profiles.ts";
import type { Quote } from "../schema/quote.ts";
import { fromExchangeLocal } from "../normalise/timestamps.ts";

let attached: { store: ColumnStore; profile: Profile } | undefined;

/** Called by the sink selector once the store exists. Module-level, deliberately. */
export function attachStore(store: ColumnStore, profile: Profile): void {
  attached = { store, profile };
}

/**
 * Reads only sealed segments, and shifts observedAt back out of exchange-local time so callers
 * see UTC. The staging segment and the write ahead log are both invisible here.
 */
export async function query(symbol: string, limit = 100): Promise<Quote[]> {
  if (!attached) return [];
  const { store, profile } = attached;

  const out: Quote[] = [];
  for (let i = store.sealedSegments().length - 1; i >= 0 && out.length < limit; i -= 1) {
    const segment = store.sealedSegments()[i];
    if (!segment) continue;
    for (const row of segment.rows) {
      if (row.symbol !== symbol) continue;
      out.push({ ...row, observedAt: fromExchangeLocal(new Date(row.observedAt), profile).toISOString() });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * The entry point the sector enrichment stage uses. It is the reason src/enrich/sectorTagger.ts
 * imports this module, and therefore the reason the ingest path depends on the query path.
 */
export async function lastKnownSector(isin: string): Promise<string | undefined> {
  if (!attached || isin === "") return undefined;
  const segments = attached.store.sealedSegments();
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const rows = segments[i]?.rows ?? [];
    for (let j = rows.length - 1; j >= 0; j -= 1) {
      const row = rows[j];
      if (row && row.isin === isin && row.sector && row.sector !== "unclassified") return row.sector;
    }
  }
  return undefined;
}

export function sealedSegmentCount(): number {
  return attached ? attached.store.sealedSegments().length : 0;
}
