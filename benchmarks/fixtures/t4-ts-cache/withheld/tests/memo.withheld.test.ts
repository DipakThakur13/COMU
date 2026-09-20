import test from "node:test";
import assert from "node:assert/strict";
import { memoize } from "../src/memo.ts";

// Grader-only. These exercise the memo helper itself, so a fix that only repairs the three
// lookups in src/pricing.ts leaves them failing.
test("every argument takes part in the cache key", () => {
  const join = memoize((a: string, b: string): string => `${a}/${b}`);
  assert.equal(join("x", "1"), "x/1");
  assert.equal(join("x", "2"), "x/2");
  assert.equal(join("y", "1"), "y/1");
  assert.equal(join("x", "1"), "x/1");
});

test("arguments past the second count too", () => {
  const join = memoize((a: string, b: string, c: string): string => `${a}${b}${c}`);
  assert.equal(join("a", "b", "c"), "abc");
  assert.equal(join("a", "b", "d"), "abd");
});

test("a repeated call still reuses the first result", () => {
  let calls = 0;
  const slow = memoize((a: string, b: number): string => {
    calls += 1;
    return `${a}${b}`;
  });
  assert.equal(slow("a", 1), "a1");
  assert.equal(slow("a", 1), "a1");
  assert.equal(calls, 1);
  assert.equal(slow("a", 2), "a2");
  assert.equal(slow("a", 2), "a2");
  assert.equal(calls, 2);
});

test("a call with no arguments is cached", () => {
  let calls = 0;
  const now = memoize((): number => {
    calls += 1;
    return 7;
  });
  assert.equal(now(), 7);
  assert.equal(now(), 7);
  assert.equal(calls, 1);
});
