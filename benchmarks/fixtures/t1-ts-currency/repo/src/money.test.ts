import test from "node:test";
import assert from "node:assert/strict";
import { formatCents, fromCents, toCents, totalCents } from "./money.ts";

test("an amount is converted to the nearest cent", () => {
  assert.equal(toCents(1.15), 115);
});

test("cents convert back to a decimal amount", () => {
  assert.equal(fromCents(115), 1.15);
});

test("cents render with two decimal places", () => {
  assert.equal(formatCents(1999), "19.99");
});

test("a total is the sum of the amounts in cents", () => {
  assert.equal(totalCents([1, 2.5]), 350);
});
