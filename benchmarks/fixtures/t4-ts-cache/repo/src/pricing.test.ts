import test from "node:test";
import assert from "node:assert/strict";
import { shippingCost, taxRate, unitPrice } from "./pricing.ts";

test("a price comes from the catalogue", () => {
  assert.equal(unitPrice("gizmo", "JP"), 1250);
});

test("the same product has a different price in each region", () => {
  assert.equal(unitPrice("widget", "US"), 1200);
  assert.equal(unitPrice("widget", "EU"), 1450);
});

test("a region has one tax rate per category", () => {
  assert.equal(taxRate("US", "standard"), 7);
  assert.equal(taxRate("US", "reduced"), 3);
});

test("shipping depends on the weight of the parcel", () => {
  assert.equal(shippingCost("EU", 1), 850);
  assert.equal(shippingCost("EU", 3), 1150);
});
