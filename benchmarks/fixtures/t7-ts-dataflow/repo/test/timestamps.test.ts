import assert from "node:assert/strict";
import test from "node:test";
import { profileByName } from "../src/config/profiles.ts";
import { fromExchangeLocal, toExchangeLocal } from "../src/normalise/timestamps.ts";
import { toMinorUnits, minorDigits } from "../src/normalise/currency.ts";

test("the exchange shift and its inverse cancel", () => {
  const profile = profileByName("xetra");
  const instant = new Date("2024-05-02T09:30:00.000Z");
  const local = toExchangeLocal(instant, profile);
  assert.equal(local.toISOString(), "2024-05-02T11:30:00.000Z");
  assert.equal(fromExchangeLocal(local, profile).toISOString(), instant.toISOString());
});

test("the default profile does not shift at all", () => {
  const profile = profileByName("default");
  const instant = new Date("2024-05-02T09:30:00.000Z");
  assert.equal(toExchangeLocal(instant, profile).toISOString(), instant.toISOString());
});

test("minor units follow the currency", () => {
  assert.equal(minorDigits("JPY"), 0);
  assert.equal(toMinorUnits(12.345, "GBP"), 1235);
  assert.equal(toMinorUnits(12.345, "JPY"), 12);
});
