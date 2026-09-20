import test from "node:test";
import assert from "node:assert/strict";
import { pageSlice, paginate } from "../src/pagination.ts";

// Grader-only. Held back so the fix has to be the general one rather than whatever satisfies the
// single example the agent was shown.
test("the second page starts where the first ended", () => {
  assert.deepEqual(pageSlice([1, 2, 3, 4, 5, 6], 1, 3), [4, 5, 6]);
});

test("a trailing partial page returns only what is left", () => {
  assert.deepEqual(pageSlice([1, 2, 3, 4, 5], 2, 2), [5]);
});

test("a page beyond the end is empty", () => {
  assert.deepEqual(pageSlice([1, 2, 3], 9, 2), []);
});

test("every item appears exactly once across all pages", () => {
  const items = [1, 2, 3, 4, 5, 6, 7];
  const size = 3;
  const seen: number[] = [];
  for (let page = 0; page < paginate(items, 0, size).totalPages; page++) {
    seen.push(...pageSlice(items, page, size));
  }
  assert.deepEqual(seen, items);
});
