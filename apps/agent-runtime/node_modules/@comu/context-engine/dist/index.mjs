// src/engine.ts
import { resolveAndVerifyPath } from "@comu/tool-filesystem";
import * as fs from "fs/promises";
var ContextEngine = class {
  constructor(executor) {
    this.executor = executor;
  }
  executor;
  async compile(request, budget) {
    const rootPath = request.workspace.rootPath;
    const compiled = {
      workspace: request.workspace,
      openFiles: []
    };
    if (request.editor?.selection) {
      compiled.selection = request.editor.selection;
    }
    const dummyToolContext = {
      taskId: request.taskId,
      workspace: request.workspace,
      limits: { maxResults: 1e3, maxBytes: budget.maxFileChars }
    };
    if (request.editor?.activeFile) {
      compiled.activeFile = await this.safeReadFile(request.editor.activeFile, rootPath, budget.maxFileChars);
    }
    if (request.editor?.openFiles) {
      for (const filePath of request.editor.openFiles) {
        if (filePath === request.editor.activeFile) continue;
        const fileCtx = await this.safeReadFile(filePath, rootPath, budget.maxFileChars);
        if (fileCtx) {
          compiled.openFiles.push(fileCtx);
        }
      }
    }
    try {
      const treeResult = await this.executor.execute("get_workspace_tree", { maxDepth: budget.maxTreeDepth }, dummyToolContext);
      compiled.repositoryMap = {
        tree: treeResult.tree,
        isTruncated: treeResult.truncated
      };
    } catch (e) {
      console.warn("Failed to generate repository map context:", e);
    }
    return compiled;
  }
  async safeReadFile(filePath, rootPath, maxChars) {
    try {
      const fullPath = resolveAndVerifyPath(filePath, rootPath);
      const content = await fs.readFile(fullPath, "utf-8");
      if (content.length > maxChars) {
        return {
          path: filePath,
          content: content.substring(0, maxChars),
          isTruncated: true
        };
      }
      return {
        path: filePath,
        content,
        isTruncated: false
      };
    } catch (e) {
      return void 0;
    }
  }
};
export {
  ContextEngine
};
