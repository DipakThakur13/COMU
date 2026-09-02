import { ChangeSet, ChangedFile, DiffEngine } from "./interfaces.js";
import * as diff from "diff";

export class ComuDiffEngine implements DiffEngine {
  createChangeSet(taskId: string, workspaceId?: string): ChangeSet {
    return {
      changeSetId: `cs-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      taskId,
      workspaceId,
      status: "ACTIVE",
      changes: new Map(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  recordChange(
    changeSet: ChangeSet,
    path: string,
    operation: "CREATE" | "MODIFY",
    newContent: string,
    originalContent?: string,
    originalHash?: string,
    newHash?: string
  ): void {
    const existing = changeSet.changes.get(path);

    if (existing) {
      // If we are modifying a file that was already modified in this task,
      // preserve the *first* original state, and just update the new state.
      existing.newContent = newContent;
      if (newHash) existing.newHash = newHash;
    } else {
      // First time we are tracking a change for this file in this task
      changeSet.changes.set(path, {
        path,
        operation,
        originalContent,
        newContent,
        originalHash,
        newHash
      });
    }

    changeSet.updatedAt = new Date().toISOString();
  }

  getUnifiedDiff(changeSet: ChangeSet, path: string): string | undefined {
    const change = changeSet.changes.get(path);
    if (!change) return undefined;

    const oldText = change.originalContent ?? "";
    const newText = change.newContent;
    
    const patch = diff.createPatch(
      path,
      oldText,
      newText,
      "original",
      "modified"
    );
    
    return patch;
  }

  getDiffs(changeSet: ChangeSet): Map<string, string> {
    const diffs = new Map<string, string>();
    for (const [path] of changeSet.changes) {
      const patch = this.getUnifiedDiff(changeSet, path);
      if (patch) {
        diffs.set(path, patch);
      }
    }
    return diffs;
  }
}
