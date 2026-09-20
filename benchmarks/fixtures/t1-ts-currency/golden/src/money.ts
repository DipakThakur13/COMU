/**
 * Money is held as whole cents. Only this module converts between cents and the decimal amounts
 * the catalogue quotes.
 */

/** Converts a decimal amount, such as 1.15, to whole cents. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Converts whole cents back to a decimal amount. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Sums decimal amounts in cents, so the total carries no floating point drift. */
export function totalCents(amounts: number[]): number {
  return amounts.reduce((sum, amount) => sum + toCents(amount), 0);
}

/** Renders whole cents with two decimal places. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
