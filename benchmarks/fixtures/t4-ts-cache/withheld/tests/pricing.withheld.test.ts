import test from "node:test";
import assert from "node:assert/strict";
import { shippingCost, taxRate, unitPrice } from "../src/pricing.ts";

// Grader-only. The whole catalogue, asked for in an interleaved order.
test("every sku keeps its own price in every region", () => {
  const expected: Array<[string, string, number]> = [
    ["widget", "US", 1200],
    ["gizmo", "US", 900],
    ["widget", "EU", 1450],
    ["gizmo", "EU", 1100],
    ["widget", "JP", 1600],
    ["gizmo", "JP", 1250]
  ];
  for (const [sku, region, price] of expected) {
    assert.equal(unitPrice(sku, region), price, `${sku} in ${region}`);
  }
  for (const [sku, region, price] of expected) {
    assert.equal(unitPrice(sku, region), price, `${sku} in ${region}, second time`);
  }
});

test("every region keeps both of its tax rates", () => {
  assert.equal(taxRate("EU", "reduced"), 6);
  assert.equal(taxRate("EU", "standard"), 20);
  assert.equal(taxRate("JP", "standard"), 10);
  assert.equal(taxRate("JP", "reduced"), 8);
  assert.equal(taxRate("EU", "reduced"), 6);
});

test("shipping varies with weight in every region", () => {
  assert.equal(shippingCost("US", 1), 650);
  assert.equal(shippingCost("JP", 1), 1050);
  assert.equal(shippingCost("US", 4), 1100);
  assert.equal(shippingCost("JP", 4), 1500);
  assert.equal(shippingCost("US", 1), 650);
});
