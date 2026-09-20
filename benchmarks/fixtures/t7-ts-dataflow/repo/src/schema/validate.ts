import { MAX_PRICE_MINOR, MAX_SIZE, REQUIRED_FIELDS, type Quote } from "./quote.ts";

export type Verdict = { ok: true; quote: Quote } | { ok: false; reason: string };

/**
 * The only schema check in the pipeline. It is called from the sink stage, which is the last
 * stage, so everything upstream of it runs on records that may turn out not to be quotes.
 */
export function validateQuote(record: Record<string, unknown>): Verdict {
  for (const field of REQUIRED_FIELDS) {
    const value = record[field];
    if (value === undefined || value === null || value === "") {
      return { ok: false, reason: "missing " + String(field) };
    }
  }

  const priceMinor = Number(record.priceMinor);
  if (!Number.isInteger(priceMinor) || priceMinor < 0 || priceMinor > MAX_PRICE_MINOR) {
    return { ok: false, reason: "priceMinor out of range" };
  }

  const size = Number(record.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_SIZE) {
    return { ok: false, reason: "size out of range" };
  }

  return { ok: true, quote: { ...(record as unknown as Quote), priceMinor, size } };
}
