import { describe, it, expect } from "vitest";
import { CanonicalToolCallParser } from "../src/parser.js";

describe("Batch 3: CanonicalToolCallParser Tests", () => {
  const parser = new CanonicalToolCallParser();

  it("TEST A: should treat 'I will call read_file' as TEXT and avoid execution", () => {
    const res = parser.parse("I will call read_file.");
    expect(res.type).toBe("text");
    if (res.type === "text") {
      expect(res.content).toBe("I will call read_file.");
    }
  });

  it("TEST B: should treat 'I will run npm test' as TEXT", () => {
    const res = parser.parse("I will run npm test.");
    expect(res.type).toBe("text");
  });

  it("TEST C: should treat 'I will edit auth.ts' as TEXT", () => {
    const res = parser.parse("I will edit auth.ts.");
    expect(res.type).toBe("text");
  });

  it("TEST D: should parse valid canonical read_file call correctly", () => {
    const validCall = {
      id: "call_123",
      name: "read_file",
      arguments: { path: "src/auth.ts" }
    };
    const res = parser.parse(validCall);
    expect(res.type).toBe("tool_call");
    if (res.type === "tool_call") {
      expect(res.call.id).toBe("call_123");
      expect(res.call.name).toBe("read_file");
      expect(res.call.arguments.path).toBe("src/auth.ts");
    }
  });

  it("TEST E: should identify malformed tool call with missing arguments", () => {
    const invalidCall = {
      id: "call_123",
      name: "read_file"
      // missing arguments
    };
    const res = parser.parse(invalidCall);
    expect(res.type).toBe("malformed_tool_call");
    if (res.type === "malformed_tool_call") {
      expect(res.error).toBe("MISSING_ARGUMENTS");
    }
  });

  it("TEST E: should identify malformed tool call with invalid arguments type", () => {
    const invalidCall = {
      id: "call_123",
      name: "read_file",
      arguments: null
    };
    const res = parser.parse(invalidCall);
    expect(res.type).toBe("malformed_tool_call");
    if (res.type === "malformed_tool_call") {
      expect(res.error).toBe("INVALID_ARGUMENTS_TYPE");
    }
  });

  it("should treat arbitrary objects without name/id/args as TEXT stringified", () => {
    const res = parser.parse({ message: "hello" });
    expect(res.type).toBe("text");
    if (res.type === "text") {
      expect(res.content).toContain("hello");
    }
  });
});
