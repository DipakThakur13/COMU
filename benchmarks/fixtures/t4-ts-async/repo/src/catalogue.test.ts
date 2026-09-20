import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { loadRows, summarize, type Row } from "./catalogue.ts";

const LATENCY: Record<string, number> = { a: 30, b: 20, c: 10 };

async function load(id: string): Promise<Row> {
  await delay(LATENCY[id] ?? 0);
  return { id, label: id.toUpperCase() };
}

test("rows come back in the order they were asked for", async () => {
  const rows = await loadRows(["a", "b", "c"], load);
  assert.deepEqual(
    rows.map(row => row.id),
    ["a", "b", "c"]
  );
});

test("the summary lists the labels in the order they were asked for", async () => {
  assert.equal(await summarize(["a", "b", "c"], load), "A, B, C");
});

test("loading nothing summarises to nothing", async () => {
  assert.equal(await summarize([], load), "");
});
