import assert from "node:assert/strict";
import test from "node:test";
import { ColumnStore } from "../src/sink/columnStore.ts";
import type { Quote } from "../src/schema/quote.ts";

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "VOD",
    isin: "GB00BH4HKS39",
    venue: "XLON",
    currency: "GBP",
    baseCurrency: "GBP",
    priceMinor: 7250,
    size: 100,
    observedAt: "2024-05-02T10:30:00.000Z",
    exchangeZone: "Europe/London",
    sector: "telecoms",
    known: true,
    ...overrides
  };
}

test("a row is not readable until the segment is sealed", () => {
  const store = new ColumnStore("/tmp/segments");
  store.append(quote());
  assert.equal(store.sealedSegments().length, 0);
  assert.equal(store.stagingDepth(), 1);

  store.seal("2024-05-02T10:31:00.000Z");
  assert.equal(store.sealedSegments().length, 1);
  assert.equal(store.sealedSegments()[0]!.rows.length, 1);
});

test("a duplicate inside one staging segment is rejected", () => {
  const store = new ColumnStore("/tmp/segments");
  assert.equal(store.append(quote()), true);
  assert.equal(store.append(quote()), false);
  assert.equal(store.stagingDepth(), 1);
});

test("a duplicate that straddles a seal is stored twice", () => {
  const store = new ColumnStore("/tmp/segments");
  store.append(quote());
  store.seal("2024-05-02T10:31:00.000Z");
  assert.equal(store.append(quote()), true);
  store.seal("2024-05-02T10:32:00.000Z");

  const total = store.sealedSegments().reduce((n, segment) => n + segment.rows.length, 0);
  assert.equal(total, 2);
});
