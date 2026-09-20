import { fetchRecord, listRecordIds } from "./repository.ts";
import type { RecordRow } from "../store.ts";

export function recordSummary(id: string): string {
  const record = fetchRecord(id);
  if (record === null) return `${id}: unknown`;
  return `${record.name} (${record.status})`;
}

export function activeRecordNames(): string[] {
  return listRecordIds()
    .map(id => fetchRecord(id))
    .filter((record): record is RecordRow => record !== null && record.status === "active")
    .map(record => record.name);
}
