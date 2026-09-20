import test from "node:test";
import assert from "node:assert/strict";
import { activeRecordNames, recordSummary } from "./service.ts";

test("a known record is summarised by name and status", () => {
  assert.equal(recordSummary("r-1"), "Ada (active)");
});

test("an unknown record summarises as unknown", () => {
  assert.equal(recordSummary("r-404"), "r-404: unknown");
});

test("only active records are listed", () => {
  assert.deepEqual(activeRecordNames(), ["Ada", "Linus"]);
});
