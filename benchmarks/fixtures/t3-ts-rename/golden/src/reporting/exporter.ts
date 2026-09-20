import { listRecordIds, loadRecord } from "../records/repository.ts";

/** Nightly CSV export. Batch job: nothing in the test suite calls it. */
export function exportRecordsCsv(): string {
  const lines = ["id,name,status"];
  for (const id of listRecordIds()) {
    const record = loadRecord(id);
    if (record === null) continue;
    lines.push(`${record.id},${record.name},${record.status}`);
  }
  return lines.join("\n");
}
