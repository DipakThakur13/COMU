/*
 * The slice of Node's typings this pipeline uses, declared here so `tsc` can check it without
 * `node_modules` installed. Replace with @types/node once dependencies are installed.
 */

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
  on(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
};

declare module "node:fs" {
  const fs: {
    existsSync(path: string): boolean;
    readdirSync(path: string): string[];
    readFileSync(path: string, encoding: "utf8"): string;
  };
  export default fs;
}

declare module "node:path" {
  const path: { join(...segments: string[]): string };
  export default path;
}

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
