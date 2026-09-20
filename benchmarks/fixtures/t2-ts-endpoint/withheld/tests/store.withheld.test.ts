import test from "node:test";
import assert from "node:assert/strict";
import { addOrder, addUser, getUserOrders, listOrders, reset } from "../src/store.ts";

// Grader-only. The feature does not exist in the starting tree, so nothing the agent can see
// covers it; these are the whole specification of the new behaviour, edge cases included.

function seed(): void {
  reset();
  addUser({ id: "u1", name: "Ada" });
  addUser({ id: "u2", name: "Blaise" });
  addOrder({ id: "o1", userId: "u1", status: "pending", total: 120, placedAt: "2026-01-05" });
  addOrder({ id: "o2", userId: "u1", status: "shipped", total: 40, placedAt: "2026-02-10" });
  addOrder({ id: "o3", userId: "u2", status: "pending", total: 300, placedAt: "2026-02-10" });
  addOrder({ id: "o4", userId: "u1", status: "cancelled", total: 75, placedAt: "2026-03-01" });
  addOrder({ id: "o5", userId: "u1", status: "shipped", total: 500, placedAt: "2026-02-10" });
}

const ids = (orders: Array<{ id: string }>) => orders.map(order => order.id);

test("getUserOrders returns only that user's orders, newest first", () => {
  seed();
  assert.deepEqual(ids(getUserOrders("u1")), ["o4", "o2", "o5", "o1"]);
  assert.deepEqual(ids(getUserOrders("u2")), ["o3"]);
});

test("getUserOrders throws for an unknown user", () => {
  seed();
  assert.throws(() => getUserOrders("ghost"), /unknown user: ghost/);
});

test("getUserOrders filters by status", () => {
  seed();
  assert.deepEqual(ids(getUserOrders("u1", { status: "shipped" })), ["o2", "o5"]);
  assert.deepEqual(ids(getUserOrders("u1", { status: "cancelled" })), ["o4"]);
});

test("getUserOrders filters by minimum total inclusively", () => {
  seed();
  assert.deepEqual(ids(getUserOrders("u1", { minTotal: 120 })), ["o5", "o1"]);
  assert.deepEqual(ids(getUserOrders("u1", { minTotal: 0 })), ["o4", "o2", "o5", "o1"]);
});

test("getUserOrders filters by date inclusively", () => {
  seed();
  assert.deepEqual(ids(getUserOrders("u1", { since: "2026-02-10" })), ["o4", "o2", "o5"]);
  assert.deepEqual(ids(getUserOrders("u1", { since: "2026-03-02" })), []);
});

test("getUserOrders combines every filter", () => {
  seed();
  assert.deepEqual(ids(getUserOrders("u1", { status: "shipped", minTotal: 100, since: "2026-01-01" })), ["o5"]);
});

test("getUserOrders returns an empty array when nothing matches", () => {
  seed();
  assert.deepEqual(getUserOrders("u1", { status: "cancelled", minTotal: 1000 }), []);
  assert.deepEqual(getUserOrders("u2", { status: "shipped" }), []);
});

test("getUserOrders applies the limit after sorting", () => {
  seed();
  assert.deepEqual(ids(getUserOrders("u1", { limit: 2 })), ["o4", "o2"]);
  assert.deepEqual(ids(getUserOrders("u1", { status: "shipped", limit: 1 })), ["o2"]);
  assert.deepEqual(getUserOrders("u1", { limit: 0 }), []);
  assert.deepEqual(ids(getUserOrders("u1", { limit: 99 })), ["o4", "o2", "o5", "o1"]);
});

test("getUserOrders rejects a limit that is not a non-negative integer", () => {
  seed();
  assert.throws(() => getUserOrders("u1", { limit: -1 }), RangeError);
  assert.throws(() => getUserOrders("u1", { limit: 1.5 }), RangeError);
});

test("getUserOrders hands out copies, not the store's records", () => {
  seed();
  const found = getUserOrders("u1");
  found[0].total = -1;
  found.length = 0;
  assert.deepEqual(ids(getUserOrders("u1")), ["o4", "o2", "o5", "o1"]);
  assert.equal(getUserOrders("u1")[0].total, 75);
  assert.equal(listOrders().length, 5);
});
