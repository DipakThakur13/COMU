export interface Config {
  port: number;
  region: string;
  ledgerDsn: string;
  drainIntervalMs: number;
  cacheTtlMs: number;
  maxRetries: number;
  tariffTable: string;
}

function num(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && raw !== undefined && raw !== "" ? parsed : fallback;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  return {
    port: num(env.PORT, 8080),
    region: env.REGION ?? "eu-west",
    ledgerDsn: env.LEDGER_DSN ?? "",
    drainIntervalMs: num(env.DRAIN_INTERVAL_MS, 250),
    cacheTtlMs: num(env.CACHE_TTL_MS, 30_000),
    maxRetries: num(env.LEDGER_MAX_RETRIES, 3),
    tariffTable: env.TARIFF_TABLE ?? "standard-2024"
  };
}
