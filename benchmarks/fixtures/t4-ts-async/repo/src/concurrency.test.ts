import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { mapConcurrent } from "./concurrency.ts";

test("a result comes back for every item, in the order the items were given", async () => {
  const items = [1, 2, 3, 4];
  const doubled = await mapConcurrent(items, 4, async item => {
    await delay((5 - item) * 20);
    return item * 2;
  });
  assert.deepEqual(doubled, [2, 4, 6, 8]);
});

test("no more than the limit run at once", async () => {
  let running = 0;
  let peak = 0;
  await mapConcurrent([1, 2, 3, 4, 5, 6], 2, async item => {
    running += 1;
    peak = Math.max(peak, running);
    await delay(5);
    running -= 1;
    return item;
  });
  assert.equal(peak, 2);
});

test("an empty list of items produces no results", async () => {
  const results = await mapConcurrent<number, number>([], 3, async item => item);
  assert.deepEqual(results, []);
});
