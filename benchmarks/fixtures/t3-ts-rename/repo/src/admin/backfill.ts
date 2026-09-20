import { fetchRecord } from "../records/repository.ts";

/** One-off maintenance script. Batch job: nothing in the test suite calls it. */
export function backfillUpdatedAt(ids: string[], stamp: string): string[] {
  const touched: string[] = [];
  for (const id of ids) {
    const record = fetchRecord(id);
    if (record === null) continue;
    record.updatedAt = stamp;
    touched.push(record.id);
  }
  return touched;
}
