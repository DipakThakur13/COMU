export interface Quote {
  symbol: string;
  isin?: string;
  venue: string;
  currency: string;
  baseCurrency: string;
  priceMinor: number;
  size: number;
  /** Exchange-local, not UTC. See src/normalise/timestamps.ts. */
  observedAt: string;
  exchangeZone: string;
  sector: string;
  known: boolean;
}

export const REQUIRED_FIELDS: Array<keyof Quote> = [
  "symbol",
  "venue",
  "currency",
  "priceMinor",
  "size",
  "observedAt"
];

export const MAX_PRICE_MINOR = 1_000_000_000;
export const MAX_SIZE = 10_000_000;
