export interface RecordRow {
  id: string;
  name: string;
  status: "active" | "archived";
  updatedAt: string;
}

const ROWS: RecordRow[] = [
  { id: "r-1", name: "Ada", status: "active", updatedAt: "2026-01-04" },
  { id: "r-2", name: "Grace", status: "archived", updatedAt: "2026-01-09" },
  { id: "r-3", name: "Linus", status: "active", updatedAt: "2026-02-11" }
];

/** The only thing that touches the backing table. */
export function readRow(id: string): RecordRow | undefined {
  return ROWS.find(row => row.id === id);
}

export function rowIds(): string[] {
  return ROWS.map(row => row.id);
}
