import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SearchTextTool } from "../src/search_text.js";
import { ToolContext } from "@comu/tool-core";
import * as fs from "fs/promises";
import * as path from "path";

describe("Search Tools", () => {
  const root = path.resolve(__dirname, "fixtures");
  let dummyContext: ToolContext;

  beforeEach(async () => {
    dummyContext = {
      taskId: "test",
      workspace: { rootPath: root },
      limits: { maxResults: 100, maxBytes: 1024 * 1024 }
    };
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    
    await fs.writeFile(path.join(root, "src", "code.ts"), "export const API_KEY = 'secret';\nconsole.log(API_KEY);");
    await fs.writeFile(path.join(root, "node_modules", "ignore.ts"), "export const API_KEY = 'should_ignore';");
    
    // Create a dummy binary file
    const binData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
    await fs.writeFile(path.join(root, "src", "data.bin"), binData);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("should find matching text", async () => {
    const result = await SearchTextTool.execute({ query: "API_KEY" }, dummyContext);
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].path).toContain("code.ts");
    expect(result.truncated).toBe(false);
  });

  it("should ignore node_modules", async () => {
    const result = await SearchTextTool.execute({ query: "should_ignore" }, dummyContext);
    expect(result.matches).toHaveLength(0);
  });

  it("should skip binary files", async () => {
    // Write something that might match if it was read as text, but it's binary
    const binData = Buffer.concat([Buffer.from([0x00]), Buffer.from("API_KEY")]);
    await fs.writeFile(path.join(root, "src", "bad.bin"), binData);
    
    const result = await SearchTextTool.execute({ query: "API_KEY" }, dummyContext);
    // Should only find the 2 matches in code.ts, not in bad.bin
    expect(result.matches).toHaveLength(2);
  });

  it("should respect max limits", async () => {
    dummyContext.limits.maxResults = 1;
    const result = await SearchTextTool.execute({ query: "API_KEY" }, dummyContext);
    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});
