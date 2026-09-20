import type { Profile } from "../config/profiles.ts";
import type { Stage } from "../pipeline/stage.ts";

/**
 * Shifts an instant into exchange-local wall clock time.
 *
 * This is the decision that catches everyone: records are NOT stored in UTC. The pipeline writes
 * `observedAt` as exchange-local, because the desk's overnight reconciliation compares segments
 * against the exchange's own end-of-day files, which are local. `src/query/reader.ts` shifts the
 * value back on the way out, so the two cancel and the API still speaks UTC.
 */
export function toExchangeLocal(instant: Date, profile: Profile): Date {
  return new Date(instant.getTime() + profile.exchangeOffsetMinutes * 60_000);
}

export function fromExchangeLocal(local: Date, profile: Profile): Date {
  return new Date(local.getTime() - profile.exchangeOffsetMinutes * 60_000);
}

export function timestampStage(profile: Profile): Stage {
  return {
    name: "timestamps",
    async apply(record, context) {
      const raw = record.observedAt;
      const parsed = typeof raw === "number" ? new Date(raw) : new Date(String(raw ?? ""));
      if (Number.isNaN(parsed.getTime())) {
        context.bump("timestamps.unparseable");
        return { ...record, observedAt: undefined };
      }
      context.bump("timestamps.shifted");
      return {
        ...record,
        observedAt: toExchangeLocal(parsed, profile).toISOString(),
        exchangeZone: profile.exchangeZone
      };
    }
  };
}
