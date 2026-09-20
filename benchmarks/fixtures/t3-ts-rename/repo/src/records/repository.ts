import { readRow, rowIds, type RecordRow } from "../store.ts";

/** Reads one record from the store, or null when there is no such record. */
export function fetchRecord(id: string): RecordRow | null {
  return readRow(id) ?? null;
}

export function listRecordIds(): string[] {
  return rowIds();
}
