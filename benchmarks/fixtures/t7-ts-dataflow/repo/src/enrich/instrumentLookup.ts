import type { Stage } from "../pipeline/stage.ts";

interface Instrument {
  symbol: string;
  isin: string;
  lotSize: number;
}

/**
 * A static table standing in for the reference data service the deploy mounts.
 */
const TABLE: Instrument[] = [
  { symbol: "VOD", isin: "GB00BH4HKS39", lotSize: 1 },
  { symbol: "BP", isin: "GB0007980591", lotSize: 1 },
  { symbol: "HSBA", isin: "GB0005405286", lotSize: 1 },
  { symbol: "SAP", isin: "DE0007164600", lotSize: 1 },
  { symbol: "BMW", isin: "DE0005190003", lotSize: 1 }
];

const bySymbol = new Map(TABLE.map(row => [row.symbol, row]));

export function lookupInstrument(symbol: string): Instrument | undefined {
  return bySymbol.get(symbol.toUpperCase());
}

/** Unknown symbols are tagged rather than dropped; the sink decides what to do with them. */
export function instrumentStage(): Stage {
  return {
    name: "instrument",
    async apply(record, context) {
      const symbol = String(record.symbol ?? "");
      const found = lookupInstrument(symbol);
      if (!found) {
        context.bump("instrument.unknown");
        return { ...record, isin: undefined, known: false };
      }
      context.bump("instrument.resolved");
      return { ...record, isin: found.isin, lotSize: found.lotSize, known: true };
    }
  };
}
