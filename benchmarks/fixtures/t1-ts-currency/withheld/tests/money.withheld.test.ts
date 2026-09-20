import test from "node:test";
import assert from "node:assert/strict";
import { formatCents, toCents, totalCents } from "../src/money.ts";

// Grader-only. The visible test shows one amount; these cover the general case, so neither a
// special case for that amount nor a switch to always rounding up passes.
test("awkward amounts land on the nearest cent", () => {
  assert.equal(toCents(1.15), 115);
  assert.equal(toCents(19.99), 1999);
  assert.equal(toCents(2.3), 230);
  assert.equal(toCents(4.1), 410);
  assert.equal(toCents(8.12), 812);
  assert.equal(toCents(0.29), 29);
});

test("an amount already on a cent boundary is not pushed up", () => {
  assert.equal(toCents(1.1), 110);
  assert.equal(toCents(0.07), 7);
  assert.equal(toCents(2.2), 220);
  assert.equal(toCents(12.34), 1234);
  assert.equal(toCents(0), 0);
});

test("a refund rounds the same way a charge does", () => {
  assert.equal(toCents(-19.99), -1999);
  assert.equal(toCents(-1.15), -115);
});

test("a basket total is exact", () => {
  assert.equal(totalCents([19.99, 1.15, 0.29]), 2143);
  assert.equal(formatCents(totalCents([19.99, 1.15])), "21.14");
});
