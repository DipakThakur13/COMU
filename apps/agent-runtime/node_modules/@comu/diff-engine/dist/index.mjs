// src/engine.ts
import * as diff from "diff";
var ComuDiffEngine = class {
  createChangeSet(taskId, workspaceId) {
    return {
      changeSetId: `cs-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      taskId,
      workspaceId,
      status: "ACTIVE",
      changes: /* @__PURE__ */ new Map(),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  recordChange(changeSet, path, operation, newContent, originalContent, originalHash, newHash) {
    const existing = changeSet.changes.get(path);
    if (existing) {
      existing.newContent = newContent;
      if (newHash) existing.newHash = newHash;
    } else {
      changeSet.changes.set(path, {
        path,
        operation,
        originalContent,
        newContent,
        originalHash,
        newHash
      });
    }
    changeSet.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  getUnifiedDiff(changeSet, path) {
    const change = changeSet.changes.get(path);
    if (!change) return void 0;
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
  getDiffs(changeSet) {
    const diffs = /* @__PURE__ */ new Map();
    for (const [path] of changeSet.changes) {
      const patch = this.getUnifiedDiff(changeSet, path);
      if (patch) {
        diffs.set(path, patch);
      }
    }
    return diffs;
  }
};
export {
  ComuDiffEngine
};
