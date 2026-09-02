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
  ContextEngine: () => ContextEngine
});
module.exports = __toCommonJS(index_exports);

// src/engine.ts
var import_tool_filesystem = require("@comu/tool-filesystem");
var fs = __toESM(require("fs/promises"));
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
      const fullPath = (0, import_tool_filesystem.resolveAndVerifyPath)(filePath, rootPath);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ContextEngine
});
