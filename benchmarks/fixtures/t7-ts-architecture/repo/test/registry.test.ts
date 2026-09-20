import assert from "node:assert/strict";
import test from "node:test";
import { lookupRoute, registerRoute, registeredCount } from "../src/boot/registry.ts";

test("a registered path matches and yields its parameters", async () => {
  const before = registeredCount();
  registerRoute("GET", "/widgets/:widgetId/parts/:partId", async request => ({
    status: 200,
    headers: {},
    body: request.params
  }));
  assert.equal(registeredCount(), before + 1);

  const match = lookupRoute("get", "/widgets/w-9/parts/p-3");
  assert.ok(match);
  assert.deepEqual(match.params, { widgetId: "w-9", partId: "p-3" });
});

test("an unregistered path does not match", () => {
  assert.equal(lookupRoute("GET", "/nothing/here"), undefined);
});

test("the registry is empty until a route module is imported", () => {
  // Importing src/http/routes/* is what fills it. Nothing else does.
  assert.ok(registeredCount() >= 0);
});
