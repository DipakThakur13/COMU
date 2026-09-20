import test from "node:test";
import assert from "node:assert/strict";
import { pageSlice, paginate } from "./pagination.ts";

test("a full page contains every item in the page", () => {
  assert.deepEqual(pageSlice([1, 2, 3, 4, 5, 6], 0, 3), [1, 2, 3]);
});

test("totalPages counts partial pages", () => {
  assert.equal(paginate([1, 2, 3, 4, 5], 0, 2).totalPages, 3);
});
