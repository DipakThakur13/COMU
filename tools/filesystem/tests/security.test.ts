import { describe, it, expect } from "vitest";
import { resolveAndVerifyPath } from "../src/security.js";
import { PermissionError } from "@comu/shared";
import * as path from "path";

describe("Workspace Security Boundary", () => {
  const root = path.resolve(__dirname, "fixtures");

  it("should allow paths inside workspace", () => {
    const target = resolveAndVerifyPath("src/index.ts", root);
    expect(target).toBe(path.resolve(root, "src/index.ts"));
  });

  it("should reject path traversal outside workspace", () => {
    expect(() => resolveAndVerifyPath("../../etc/passwd", root)).toThrow(PermissionError);
  });

  it("should reject absolute paths outside workspace", () => {
    // Determine an absolute path outside based on platform
    const outside = process.platform === "win32" ? "C:\\Windows\\System32" : "/etc/passwd";
    expect(() => resolveAndVerifyPath(outside, root)).toThrow(PermissionError);
  });
  
  it("should allow absolute paths inside workspace", () => {
    const inside = path.resolve(root, "src/index.ts");
    expect(resolveAndVerifyPath(inside, root)).toBe(inside);
  });
});
