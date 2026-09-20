import type { Quote } from "../schema/quote.ts";

/**
 * The deduplication key. Venue and the exchange-local timestamp are both part of it, so the same
 * trade reported by two venues is two rows, and the same trade re-read after a restart is one.
 */
export function quoteKey(quote: Pick<Quote, "symbol" | "venue" | "observedAt" | "priceMinor">): string {
  return [quote.symbol, quote.venue, quote.observedAt, String(quote.priceMinor)].join("|");
}

/** Small, stable, non-cryptographic hash used for segment file names. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
