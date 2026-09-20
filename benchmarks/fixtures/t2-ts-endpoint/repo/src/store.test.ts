import test from "node:test";
import assert from "node:assert/strict";
import { addOrder, addUser, getUser, listOrders, reset } from "./store.ts";

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

test("a user can be read back after being added", () => {
  seed();
  assert.deepEqual(getUser("u1"), { id: "u1", name: "Ada" });
});

test("an unknown user reads back as undefined", () => {
  seed();
  assert.equal(getUser("nobody"), undefined);
});

test("an order for an unknown user is rejected", () => {
  seed();
  assert.throws(
    () => addOrder({ id: "o9", userId: "ghost", status: "pending", total: 1, placedAt: "2026-01-01" }),
    /unknown user: ghost/
  );
});

test("a duplicate order id is rejected", () => {
  seed();
  assert.throws(
    () => addOrder({ id: "o1", userId: "u1", status: "pending", total: 1, placedAt: "2026-01-01" }),
    /duplicate order: o1/
  );
});

test("listOrders returns every order, newest first", () => {
  seed();
  assert.deepEqual(
    listOrders().map(order => order.id),
    ["o4", "o2", "o3", "o5", "o1"]
  );
});

test("the store cannot be mutated through a listed order", () => {
  seed();
  const listed = listOrders();
  listed[0].total = -1;
  listed.length = 0;
  assert.equal(listOrders()[0].total, 75);
  assert.equal(listOrders().length, 5);
});
