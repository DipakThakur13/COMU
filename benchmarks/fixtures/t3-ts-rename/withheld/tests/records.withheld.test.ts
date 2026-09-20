import test from "node:test";
import assert from "node:assert/strict";
import { handleGetRecord } from "../src/records/controller.ts";
import { cachedRecord, clearRecordCache } from "../src/records/cache.ts";

// Grader-only. Every assertion goes through a name the refactor does not touch, so the suite is
// green both before the rename and after it. Whether the rename was finished is decided by the
// forbidden-string check, not by these tests.
test("the controller answers 200 with the summary of a known record", () => {
  clearRecordCache();
  assert.deepEqual(handleGetRecord("r-2"), { status: 200, body: "Grace (archived)" });
});

test("the controller answers 404 for an unknown record", () => {
  clearRecordCache();
  assert.deepEqual(handleGetRecord("r-404"), { status: 404, body: "r-404: unknown" });
});

test("the cache returns the same row on a second read", () => {
  clearRecordCache();
  assert.equal(cachedRecord("r-1"), cachedRecord("r-1"));
});

test("the cache reports a miss as null", () => {
  clearRecordCache();
  assert.equal(cachedRecord("r-404"), null);
});
