import { CompiledContext, ContextBudget, FileContext, WorkingSet } from "./interfaces.js";
import { TaskRequest } from "@comu/protocol";
import { ToolExecutor, ToolContext } from "@comu/tool-core";

export class ContextEngine {
  constructor(private executor: ToolExecutor) {}

  async compile(
    request: TaskRequest, 
    workingSet: WorkingSet, 
    budget: ContextBudget
  ): Promise<CompiledContext> {
    const rootPath = request.workspace.rootPath;
    
    const compiled: CompiledContext = {
      workspace: request.workspace,
      openFiles: []
    };

    if (workingSet.selection) {
      compiled.selection = workingSet.selection;
    }

    let currentChars = 0;

    const addFileToContext = (fileCtx: FileContext): boolean => {
      // Very basic budget enforcement
      if (currentChars + fileCtx.content.length <= budget.maxTotalChars) {
        compiled.openFiles.push(fileCtx);
        currentChars += fileCtx.content.length;
        return true;
      }
      return false;
    };

    // 1. Process active file first (High priority)
    if (workingSet.activeFile) {
      compiled.activeFile = workingSet.activeFile;
      currentChars += workingSet.activeFile.content.length;
    }

    // 2. Add modified files or recently inspected if we have budget
    const seenPaths = new Set<string>();
    if (workingSet.activeFile) seenPaths.add(workingSet.activeFile.path);

    for (const f of workingSet.recentlyInspectedFiles) {
      if (seenPaths.has(f.path)) continue;
      if (addFileToContext(f)) {
        seenPaths.add(f.path);
      } else {
        break; // budget exhausted
      }
    }

    // Add other open files if budget allows
    for (const f of workingSet.openFiles) {
      if (seenPaths.has(f.path)) continue;
      if (addFileToContext(f)) {
        seenPaths.add(f.path);
      }
    }

    // Attach search results & diagnostics to metadata
    compiled.metadata = {
      diagnostics: workingSet.diagnostics,
      searchResults: workingSet.searchResults,
      modifiedFiles: workingSet.modifiedFiles
    };

    // 3. Generate repository map (Low priority, optionally if requested/budget allows)
    const dummyToolContext: ToolContext = {
      taskId: request.taskId,
      workspace: request.workspace,
      limits: { maxResults: 1000, maxBytes: budget.maxFileChars }
    };
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

}
