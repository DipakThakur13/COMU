import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ContextEngine } from "../src/engine.js";
import { ToolExecutor, ToolRegistry } from "@comu/tool-core";
import { GetWorkspaceTreeTool } from "@comu/tool-filesystem";
import * as fs from "fs/promises";
import * as path from "path";
import { TaskRequest } from "@comu/protocol";

describe("Context Engine", () => {
  const root = path.resolve(__dirname, "fixtures");
  let engine: ContextEngine;
  let registry: ToolRegistry;
  let executor: ToolExecutor;

  beforeEach(async () => {
    registry = new ToolRegistry();
    registry.register(GetWorkspaceTreeTool);
    executor = new ToolExecutor(registry);
    engine = new ContextEngine(executor);

    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "active.ts"), "active file content");
    await fs.writeFile(path.join(root, "src", "open.ts"), "open file content".repeat(100)); // Make it somewhat long
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("should compile context successfully with budgeting", async () => {
    const request: TaskRequest = {
      taskId: "test",
      prompt: "hi",
      modelId: "test",
      workspace: { rootPath: root },
      editor: {
        activeFile: "src/active.ts",
        openFiles: ["src/active.ts", "src/open.ts"],
        selection: { filePath: "src/active.ts", startLine: 1, endLine: 1, startCharacter: 0, endCharacter: 5, text: "active" }
      }
    };

    const budget = {
      maxTotalChars: 1000,
      maxFileChars: 100, // Small limit to force truncation
      maxTreeDepth: 2
    };

    const compiled = await engine.compile(request, budget);

    expect(compiled.workspace.rootPath).toBe(root);
    expect(compiled.selection?.text).toBe("active");
    
    // Check active file
    expect(compiled.activeFile?.content).toBe("active file content");
    expect(compiled.activeFile?.isTruncated).toBe(false);

    // Check open file (should be truncated because length > maxFileChars)
    expect(compiled.openFiles).toHaveLength(1);
    expect(compiled.openFiles[0].isTruncated).toBe(true);
    expect(compiled.openFiles[0].content.length).toBe(100);

    // Check repository map
    expect(compiled.repositoryMap?.tree).toContain("src/");
  });
});
