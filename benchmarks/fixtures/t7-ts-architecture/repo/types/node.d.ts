/*
 * The slice of Node's typings this service uses, declared here so `tsc` can check it without
 * `node_modules` installed. Replace with @types/node once dependencies are installed.
 */

declare const process: {
  env: Record<string, string | undefined>;
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
  on(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
};

declare module "node:assert/strict" {
  interface Assert {
    ok(value: unknown, message?: string): asserts value;
    equal<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
    deepEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
  }
  const assert: Assert;
  export default assert;
}

declare module "node:test" {
  export default function test(name: string, fn: () => void | Promise<void>): Promise<void>;
}
