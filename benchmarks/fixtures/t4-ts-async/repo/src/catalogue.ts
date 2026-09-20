import { mapConcurrent } from "./concurrency.ts";

export interface Row {
  id: string;
  label: string;
}

/** How many catalogue reads the service is allowed to have open at once. */
export const READ_LIMIT = 3;

/** Loads one row per id, in the order the ids were given. */
export async function loadRows(
  ids: readonly string[],
  load: (id: string) => Promise<Row>
): Promise<Row[]> {
  return mapConcurrent(ids, READ_LIMIT, id => load(id));
}

/** A one line summary of the rows, in the order they were requested. */
export async function summarize(
  ids: readonly string[],
  load: (id: string) => Promise<Row>
): Promise<string> {
  const rows = await loadRows(ids, load);
  return rows.map(row => row.label).join(", ");
}
