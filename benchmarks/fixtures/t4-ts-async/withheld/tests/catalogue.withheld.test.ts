import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { loadRows, summarize, type Row } from "../src/catalogue.ts";

const LATENCY: Record<string, number> = { a: 30, b: 20, c: 10, d: 25, e: 5 };

async function load(id: string): Promise<Row> {
  await delay(LATENCY[id] ?? 0);
  return { id, label: id.toUpperCase() };
}

// Grader-only. The request order here is not the sorted order.
test("rows keep the request order even when the ids are unsorted", async () => {
  const rows = await loadRows(["c", "a", "b"], load);
  assert.deepEqual(
    rows.map(row => row.id),
    ["c", "a", "b"]
  );
});

test("a batch wider than the read limit stays in order", async () => {
  const rows = await loadRows(["e", "a", "d", "b", "c"], load);
  assert.deepEqual(
    rows.map(row => row.id),
    ["e", "a", "d", "b", "c"]
  );
});

test("an id asked for twice appears twice, in place", async () => {
  const rows = await loadRows(["b", "a", "b"], load);
  assert.deepEqual(
    rows.map(row => row.id),
    ["b", "a", "b"]
  );
});

test("the summary follows the request order", async () => {
  assert.equal(await summarize(["c", "a", "b"], load), "C, A, B");
});
