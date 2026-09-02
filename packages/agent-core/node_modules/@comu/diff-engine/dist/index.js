"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  ComuDiffEngine: () => ComuDiffEngine
});
module.exports = __toCommonJS(index_exports);

// src/engine.ts
var diff = __toESM(require("diff"));
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ComuDiffEngine
});
