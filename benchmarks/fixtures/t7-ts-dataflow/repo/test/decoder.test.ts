import assert from "node:assert/strict";
import test from "node:test";
import { decoderFor, decoderByFormat } from "../src/decode/decoderRegistry.ts";

test("a csv body picks the csv decoder", () => {
  assert.equal(decoderFor("SYM,PX\nVOD,72.5\n", "drop.csv").format, "csv");
});

test("a json body in a file named csv still picks the json decoder", () => {
  const body = '{"SYM":"VOD","PX":72.5}\n';
  assert.equal(decoderFor(body, "drop.csv").format, "jsonl");
});

test("a csv body in a file named json still picks the csv decoder", () => {
  assert.equal(decoderFor("SYM,PX\nVOD,72.5\n", "drop.json").format, "csv");
});

test("csv decoding honours quoted commas", () => {
  const rows = decoderByFormat("csv").decode('SYM,NAME\nVOD,"Vodafone, plc"\n');
  assert.deepEqual(rows, [{ SYM: "VOD", NAME: "Vodafone, plc" }]);
});

test("a top level array decodes as many records", () => {
  const rows = decoderByFormat("jsonl").decode('[{"a":1},{"a":2}]');
  assert.equal(rows.length, 2);
});
