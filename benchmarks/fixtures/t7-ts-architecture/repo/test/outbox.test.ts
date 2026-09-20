import assert from "node:assert/strict";
import test from "node:test";
import { Outbox } from "../src/queue/outbox.ts";
import { FrozenClock } from "../src/adapters/systemClock.ts";
import { Metrics } from "../src/telemetry/metrics.ts";
import { createLogger } from "../src/telemetry/logger.ts";

function makeOutbox() {
  return new Outbox(new FrozenClock(new Date("2024-03-01T00:00:00Z")), new Metrics(), createLogger("test"));
}

const good = {
  account: "acct-1001",
  zone: "eu",
  parcels: [{ weightGrams: 900, lengthMm: 200, widthMm: 150, heightMm: 100 }]
};

test("a valid payload reaches the queue", () => {
  const outbox = makeOutbox();
  outbox.enqueue({ id: "cn-1", acceptedAt: "2024-03-01T00:00:00Z", traceId: "t-1", payload: good });
  assert.equal(outbox.pending(), 1);
  assert.equal(outbox.deadCount(), 0);
});

test("an invalid payload is dead lettered rather than thrown", () => {
  const outbox = makeOutbox();
  outbox.enqueue({
    id: "cn-2",
    acceptedAt: "2024-03-01T00:00:00Z",
    traceId: "t-2",
    payload: { account: "x", zone: "moon", parcels: [] }
  });
  assert.equal(outbox.pending(), 0);
  assert.equal(outbox.deadCount(), 1);
  assert.ok(outbox.deadLetters()[0]!.problems.length >= 3);
});

test("take drains oldest first", () => {
  const outbox = makeOutbox();
  for (const id of ["cn-a", "cn-b", "cn-c"]) {
    outbox.enqueue({ id, acceptedAt: "2024-03-01T00:00:00Z", traceId: "t", payload: good });
  }
  const batch = outbox.take(2);
  assert.deepEqual(batch.map(entry => entry.id), ["cn-a", "cn-b"]);
  assert.equal(outbox.pending(), 1);
});
