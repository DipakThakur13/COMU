import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { mapConcurrent } from "../src/concurrency.ts";

// Grader-only. The visible tests use inputs whose own order happens to be the sorted order, so
// they can be satisfied by sorting the results afterwards. These cannot.
test("an unsorted input keeps its own order", async () => {
  const latency: Record<string, number> = { delta: 5, alpha: 25, charlie: 15, bravo: 35 };
  const shouted = await mapConcurrent(["delta", "alpha", "charlie", "bravo"], 4, async item => {
    await delay(latency[item] ?? 0);
    return item.toUpperCase();
  });
  assert.deepEqual(shouted, ["DELTA", "ALPHA", "CHARLIE", "BRAVO"]);
});

test("a repeated item keeps its own slot", async () => {
  const latency = [30, 10, 20];
  const tagged = await mapConcurrent(["x", "y", "x"], 3, async (item, index) => {
    await delay(latency[index] ?? 0);
    return `${item}${index}`;
  });
  assert.deepEqual(tagged, ["x0", "y1", "x2"]);
});

test("a limit of one keeps the order too", async () => {
  const seen = await mapConcurrent([3, 1, 2], 1, async item => {
    await delay(item * 5);
    return item * 10;
  });
  assert.deepEqual(seen, [30, 10, 20]);
});

test("a limit wider than the input is allowed", async () => {
  const seen = await mapConcurrent(["c", "a", "b"], 10, async item => {
    await delay(item === "c" ? 20 : 5);
    return item;
  });
  assert.deepEqual(seen, ["c", "a", "b"]);
});

test("one result per item, however fast the worker is", async () => {
  const items = Array.from({ length: 12 }, (_unused, index) => 11 - index);
  const seen = await mapConcurrent(items, 5, async item => {
    if (item % 2 === 0) await delay(10);
    return item;
  });
  assert.deepEqual(seen, items);
});
