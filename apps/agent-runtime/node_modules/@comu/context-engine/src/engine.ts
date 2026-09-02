import { CompiledContext, ContextBudget, FileContext } from "./interfaces.js";
import { TaskRequest } from "@comu/protocol";
import { ToolExecutor, ToolContext } from "@comu/tool-core";
import { resolveAndVerifyPath } from "@comu/tool-filesystem";
import * as fs from "fs/promises";

export class ContextEngine {
  constructor(private executor: ToolExecutor) {}

  async compile(request: TaskRequest, budget: ContextBudget): Promise<CompiledContext> {
    const rootPath = request.workspace.rootPath;
    
    const compiled: CompiledContext = {
      workspace: request.workspace,
      openFiles: []
    };

    if (request.editor?.selection) {
      compiled.selection = request.editor.selection;
    }

    const dummyToolContext: ToolContext = {
      taskId: request.taskId,
      workspace: request.workspace,
      limits: { maxResults: 1000, maxBytes: budget.maxFileChars }
    };

    // 1. Process active file first (High priority)
    if (request.editor?.activeFile) {
      compiled.activeFile = await this.safeReadFile(request.editor.activeFile, rootPath, budget.maxFileChars);
    }

    // 2. Process other open files (Medium priority)
    if (request.editor?.openFiles) {
      for (const filePath of request.editor.openFiles) {
        if (filePath === request.editor.activeFile) continue;
        const fileCtx = await this.safeReadFile(filePath, rootPath, budget.maxFileChars);
        if (fileCtx) {
          compiled.openFiles.push(fileCtx);
        }
      }
    }

    // 3. Generate repository map (Low priority)
    try {
      const treeResult = await this.executor.execute<{dir?: string, maxDepth?: number}, any>("get_workspace_tree", { maxDepth: budget.maxTreeDepth }, dummyToolContext);
      compiled.repositoryMap = {
        tree: treeResult.tree,
        isTruncated: treeResult.truncated
      };
    } catch (e) {
      console.warn("Failed to generate repository map context:", e);
    }

    return compiled;
  }

  private async safeReadFile(filePath: string, rootPath: string, maxChars: number): Promise<FileContext | undefined> {
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
      return undefined;
    }
  }
}
