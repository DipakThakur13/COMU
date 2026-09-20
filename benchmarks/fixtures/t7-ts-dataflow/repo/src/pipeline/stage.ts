import type { RawRecord } from "../decode/decoderRegistry.ts";
import type { Quote } from "../schema/quote.ts";

export interface StageContext {
  profile: string;
  quarantine: Array<{ reason: string; raw: RawRecord }>;
  counters: Map<string, number>;
  bump(name: string, by?: number): void;
}

/**
 * A stage takes the record so far and returns the record, or undefined to drop it.
 *
 * Stages are deliberately allowed to be asynchronous: one of them does I/O, which is the reason
 * the runner awaits every stage even though most of them are pure.
 */
export interface Stage {
  readonly name: string;
  apply(record: Partial<Quote> & RawRecord, context: StageContext): Promise<(Partial<Quote> & RawRecord) | undefined>;
}

export function makeContext(profile: string): StageContext {
  const counters = new Map<string, number>();
  return {
    profile,
    quarantine: [],
    counters,
    bump(name: string, by = 1) {
      counters.set(name, (counters.get(name) ?? 0) + by);
    }
  };
}
