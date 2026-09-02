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
  NodeRecursiveSearchBackend: () => NodeRecursiveSearchBackend,
  SearchTextTool: () => SearchTextTool
});
module.exports = __toCommonJS(index_exports);

// src/backends/node_recursive.ts
var import_tool_filesystem = require("@comu/tool-filesystem");
var fs = __toESM(require("fs/promises"));
var path = __toESM(require("path"));
var NodeRecursiveSearchBackend = class {
  isBinaryString(buffer) {
    for (let i = 0; i < buffer.length && i < 1024; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  }
  async search(query, context) {
    const rootPath = context.workspace.rootPath;
    const maxResults = context.limits.maxResults ?? 100;
    const maxBytes = context.limits.maxBytes ?? 1024 * 1024 * 5;
    const ignoreList = /* @__PURE__ */ new Set([".git", "node_modules", "dist", "build", ".next", "out", "coverage"]);
    let regex;
    try {
      const flags = query.caseSensitive ? "g" : "gi";
      regex = query.isRegex ? new RegExp(query.query, flags) : new RegExp(query.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    } catch (e) {
      throw new Error(`Invalid search query: ${e}`);
    }
    const matches = [];
    let isTruncated = false;
    const walk = async (currentPath) => {
      if (context.cancellation?.isCancelled) return;
      if (matches.length >= maxResults) {
        isTruncated = true;
        return;
      }
      let entries;
      try {
        entries = await fs.readdir(currentPath, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const entry of entries) {
        if (ignoreList.has(entry.name)) continue;
        const fullPath = path.join(currentPath, entry.name);
        try {
          (0, import_tool_filesystem.resolveAndVerifyPath)(fullPath, rootPath);
        } catch {
          continue;
        }
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (matches.length >= maxResults) {
            isTruncated = true;
            return;
          }
          try {
            const stats = await fs.stat(fullPath);
            if (stats.size > maxBytes) continue;
            const fd = await fs.open(fullPath, "r");
            const buffer = Buffer.alloc(1024);
            const { bytesRead } = await fd.read(buffer, 0, 1024, 0);
            await fd.close();
            if (this.isBinaryString(buffer.subarray(0, bytesRead))) continue;
            const content = await fs.readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= maxResults) {
                isTruncated = true;
                break;
              }
              const line = lines[i];
              regex.lastIndex = 0;
              const match = regex.exec(line);
              if (match) {
                matches.push({
                  path: path.relative(rootPath, fullPath),
                  line: i + 1,
                  column: match.index + 1,
                  preview: line.trim().substring(0, 200)
                  // limit preview length
                });
              }
            }
          } catch (e) {
          }
        }
      }
    };
    await walk(rootPath);
    return {
      matches,
      truncated: isTruncated
    };
  }
};

// src/search_text.ts
var import_shared = require("@comu/shared");
var defaultBackend = new NodeRecursiveSearchBackend();
var SearchTextTool = {
  name: "search_text",
  description: "Searches for text across the workspace files",
  capabilities: ["read"],
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      isRegex: { type: "boolean" },
      caseSensitive: { type: "boolean" }
    },
    required: ["query"]
  },
  execute: async (args, context) => {
    try {
      return await defaultBackend.search(args, context);
    } catch (e) {
      throw new import_shared.ToolError(`Search failed: ${e.message}`);
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  NodeRecursiveSearchBackend,
  SearchTextTool
});
