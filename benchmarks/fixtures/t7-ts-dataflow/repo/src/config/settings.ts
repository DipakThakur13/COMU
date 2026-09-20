import type { Profile } from "./profiles.ts";

export interface Settings {
  profile: Profile;
  bufferSlots: number;
  flushEvery: number;
  watchIntervalMs: number;
  quarantineLimit: number;
  segmentDir: string;
  walPath: string;
}

function num(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(parsed) ? parsed : fallback;
}

export function loadSettings(env: Record<string, string | undefined>, profile: Profile): Settings {
  return {
    profile,
    bufferSlots: num(env.BUFFER_SLOTS, 4096),
    flushEvery: num(env.FLUSH_EVERY, 1000),
    watchIntervalMs: num(env.WATCH_INTERVAL_MS, 2000),
    quarantineLimit: num(env.QUARANTINE_LIMIT, 500),
    segmentDir: env.SEGMENT_DIR ?? "/var/lib/feed/segments",
    walPath: env.WAL_PATH ?? "/var/lib/feed/wal.log"
  };
}
