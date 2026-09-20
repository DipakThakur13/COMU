import test from "node:test";
import assert from "node:assert/strict";
import { createUser } from "./createUser.ts";
import { updateUser } from "./updateUser.ts";

test("a valid user is created with a normalised email", () => {
  assert.deepEqual(createUser({ email: "  Ada@Example.COM ", name: " Ada " }), {
    id: "u-ada@example.com",
    email: "ada@example.com",
    name: "Ada"
  });
});

test("a malformed email is rejected", () => {
  assert.throws(() => createUser({ email: "nope", name: "Ada" }), /email is malformed/);
});

test("an update keeps the existing id", () => {
  const user = createUser({ email: "ada@example.com", name: "Ada" });
  assert.equal(updateUser(user, { email: "ada@example.org", name: "Ada L" }).id, "u-ada@example.com");
});
