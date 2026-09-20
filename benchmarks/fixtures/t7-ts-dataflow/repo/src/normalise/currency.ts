import type { Profile } from "../config/profiles.ts";
import type { Stage } from "../pipeline/stage.ts";

const MINOR_DIGITS: Record<string, number> = { GBP: 2, EUR: 2, USD: 2, JPY: 0, KWD: 3 };

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2;
}

/** 12.345 GBP becomes 1234 minor units (banker-free, plain rounding). */
export function toMinorUnits(amount: number, currency: string): number {
  const factor = 10 ** minorDigits(currency);
  return Math.round(amount * factor);
}

/**
 * Converts the price to integer minor units of whatever currency the record carries.
 *
 * No FX happens anywhere in this repository. `profile.baseCurrency` is recorded on the record for
 * the query layer to compare against, and that is all it is for.
 */
export function currencyStage(profile: Profile): Stage {
  return {
    name: "currency",
    async apply(record, context) {
      const currency = String(record.currency ?? profile.baseCurrency).toUpperCase();
      const raw = Number(record.price);
      if (!Number.isFinite(raw)) {
        context.bump("currency.unparseable");
        return { ...record, currency, priceMinor: undefined };
      }
      context.bump("currency.converted");
      return { ...record, currency, baseCurrency: profile.baseCurrency, priceMinor: toMinorUnits(raw, currency) };
    }
  };
}
