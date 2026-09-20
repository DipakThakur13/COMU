import test from "node:test";
import assert from "node:assert/strict";
import { createUser } from "../src/api/createUser.ts";
import { updateUser } from "../src/api/updateUser.ts";
import { inviteUser } from "../src/api/inviteUser.ts";

// Grader-only. These pin the validation rules through the handlers, so the messages and the order
// they fire in cannot drift while the duplicated block is being moved. They say nothing about where
// the rules live: an extraction applied to only some call sites still passes every one of them.
test("an empty email is rejected before anything else", () => {
  assert.throws(() => createUser({ email: "   ", name: "A" }), /email is required/);
});

test("a one-character name is too short", () => {
  assert.throws(() => updateUser({ id: "u-1", email: "a@b.c", name: "Ada" }, { email: "a@b.c", name: "A" }), /name is too short/);
});

test("a name over sixty-four characters is too long", () => {
  assert.throws(() => inviteUser({ email: "a@b.c", name: "x".repeat(65) }), /name is too long/);
});

test("an email that is only an at sign is malformed", () => {
  assert.throws(() => inviteUser({ email: "ada@", name: "Ada" }), /email is malformed/);
});

test("a valid invitation is addressed to the normalised email", () => {
  assert.deepEqual(inviteUser({ email: " Grace@Example.COM ", name: " Grace " }), {
    to: "grace@example.com",
    subject: "Grace, you are invited"
  });
});
