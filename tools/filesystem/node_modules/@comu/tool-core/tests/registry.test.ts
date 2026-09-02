import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../src/registry.js";
import { AgentTool } from "../src/interfaces.js";
import { ToolError } from "@comu/shared";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;
  let mockTool: AgentTool;

  beforeEach(() => {
    registry = new ToolRegistry();
    mockTool = {
      name: "test_tool",
      description: "A test tool",
      capabilities: [],
      inputSchema: {},
      execute: async () => "result"
    };
  });

  it("should register and retrieve a tool", () => {
    registry.register(mockTool);
    expect(registry.get("test_tool")).toBe(mockTool);
  });

  it("should throw when getting a non-existent tool", () => {
    expect(() => registry.get("missing")).toThrow(ToolError);
  });

  it("should throw when registering a duplicate tool", () => {
    registry.register(mockTool);
    expect(() => registry.register(mockTool)).toThrow(ToolError);
  });
});
