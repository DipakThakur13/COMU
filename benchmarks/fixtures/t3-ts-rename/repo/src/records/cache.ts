import { fetchRecord } from "./repository.ts";
import type { RecordRow } from "../store.ts";

const cache = new Map<string, RecordRow | null>();

/** Reads through to the repository once per id. */
export function cachedRecord(id: string): RecordRow | null {
  if (!cache.has(id)) cache.set(id, fetchRecord(id));
  return cache.get(id) ?? null;
}

export function clearRecordCache(): void {
  cache.clear();
}
