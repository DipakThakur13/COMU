import assert from "node:assert/strict";
import test from "node:test";
import { PricingService } from "../src/services/pricing.ts";
import { billableGrams, volumetricGrams } from "../src/domain/consignment.ts";

test("volumetric weight uses the 5000 divisor", () => {
  assert.equal(volumetricGrams({ weightGrams: 0, lengthMm: 300, widthMm: 200, heightMm: 100 }), 1200);
});

test("the heavier of actual and volumetric is billed", () => {
  const grams = billableGrams({
    parcels: [
      { weightGrams: 100, lengthMm: 300, widthMm: 200, heightMm: 100 },
      { weightGrams: 4000, lengthMm: 100, widthMm: 100, heightMm: 100 }
    ]
  });
  assert.equal(grams, 1200 + 4000);
});

test("the standard tariff adds its surcharge", () => {
  const pricing = new PricingService("standard-2024");
  assert.equal(pricing.quote({ zone: "domestic", weightGrams: 500 }).minor, 349 + 95);
});

test("the economy tariff has no surcharge", () => {
  const pricing = new PricingService("economy-2023");
  assert.equal(pricing.quote({ zone: "domestic", weightGrams: 500 }).minor, 299);
});

test("an unknown zone falls back to domestic", () => {
  const pricing = new PricingService("standard-2024");
  assert.equal(pricing.quote({ zone: "mars", weightGrams: 500 }).minor, 349 + 95);
});
