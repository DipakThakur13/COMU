import { cachedRecord } from "./cache.ts";
import { recordSummary } from "./service.ts";

export interface HttpResponse {
  status: number;
  body: string;
}

export function handleGetRecord(id: string): HttpResponse {
  const record = cachedRecord(id);
  if (record === null) return { status: 404, body: `${id}: unknown` };
  return { status: 200, body: recordSummary(record.id) };
}
