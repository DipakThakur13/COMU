import assert from "node:assert/strict";
import test from "node:test";
import { RingBuffer } from "../src/buffer/ringBuffer.ts";
import { shouldPause, pressure } from "../src/buffer/backpressure.ts";

test("a buffer under capacity drains in order", () => {
  const buffer = new RingBuffer(4);
  buffer.push({ n: 1 });
  buffer.push({ n: 2 });
  assert.deepEqual([...buffer.drain()], [{ n: 1 }, { n: 2 }]);
  assert.equal(buffer.droppedCount(), 0);
});

test("a full buffer overwrites the oldest entry and counts the loss", () => {
  const buffer = new RingBuffer(3);
  for (const n of [1, 2, 3, 4, 5]) buffer.push({ n });
  assert.deepEqual([...buffer.drain()], [{ n: 3 }, { n: 4 }, { n: 5 }]);
  assert.equal(buffer.droppedCount(), 2);
});

test("backpressure is advisory and reports at the high water mark", () => {
  const buffer = new RingBuffer(10);
  for (let i = 0; i < 7; i += 1) buffer.push({ i });
  assert.equal(shouldPause(buffer), false);
  buffer.push({ i: 7 });
  assert.equal(shouldPause(buffer), true);
  assert.equal(pressure(buffer), 0.8);
});
