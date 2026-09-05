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
      workspace: { rootPath: root }
    };

    const ws = {
      activeFile: { path: "src/active.ts", content: "active file content", isTruncated: false },
      openFiles: [
        { path: "src/open.ts", content: "open file content".repeat(100), isTruncated: false }
      ],
      recentlyInspectedFiles: [],
      searchResults: [],
      diagnostics: [],
      modifiedFiles: [],
      budgets: { maxOpenFiles: 10, maxInspectedFiles: 10, maxSearchResults: 50, maxDiagnostics: 20, maxModifiedFiles: 20 },
      revision: 1,
      selection: { filePath: "src/active.ts", startLine: 1, endLine: 1, startCharacter: 0, endCharacter: 5, text: "active" }
    };

    const budget = {
      maxTotalChars: 1000,
      maxFileChars: 100, // Small limit
      maxTreeDepth: 2
    };

    const compiled = await engine.compile(request, ws, budget);

    expect(compiled.workspace.rootPath).toBe(root);
    expect(compiled.selection?.text).toBe("active");
    
    // Check active file
    expect(compiled.activeFile?.content).toBe("active file content");

    // Check open file (should be omitted completely because length > maxTotalChars budget)
    expect(compiled.openFiles).toHaveLength(0);

    // Check repository map
    expect(compiled.repositoryMap?.tree).toContain("src/");
  });
});
