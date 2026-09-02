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
  CreateFileTool: () => CreateFileTool,
  EditFileTool: () => EditFileTool,
  GetWorkspaceTreeTool: () => GetWorkspaceTreeTool,
  ListDirectoryTool: () => ListDirectoryTool,
  ReadFileTool: () => ReadFileTool,
  WriteFileTool: () => WriteFileTool,
  resolveAndVerifyPath: () => resolveAndVerifyPath
});
module.exports = __toCommonJS(index_exports);

// src/security.ts
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));
var import_shared = require("@comu/shared");
function resolveAndVerifyPath(requestPath, workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  let targetPath = requestPath;
  if (!path.isAbsolute(requestPath)) {
    targetPath = path.resolve(root, requestPath);
  } else {
    targetPath = path.resolve(requestPath);
  }
  targetPath = path.normalize(targetPath);
  const relative2 = path.relative(root, targetPath);
  if (relative2.startsWith("..") || path.isAbsolute(relative2)) {
    throw new import_shared.PermissionError(`Access denied: Path ${requestPath} resolves outside workspace boundary`);
  }
  try {
    if (fs.existsSync(targetPath)) {
      const realPath = fs.realpathSync(targetPath);
      const realRoot = fs.realpathSync(root);
      const realRelative = path.relative(realRoot, realPath);
      if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
        throw new import_shared.PermissionError(`Access denied: Symlink resolves outside workspace boundary`);
      }
    }
  } catch (e) {
    throw new import_shared.PermissionError(`Failed to verify path security: ${e.message}`);
  }
  return targetPath;
}

// src/read_file.ts
var import_shared2 = require("@comu/shared");
var fs2 = __toESM(require("fs/promises"));
var ReadFileTool = {
  name: "read_file",
  description: "Reads the contents of a file within the workspace",
  capabilities: ["read"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" }
    },
    required: ["path"]
  },
  execute: async (args, context) => {
    try {
      const targetPath = resolveAndVerifyPath(args.path, context.workspace.rootPath);
      const stats = await fs2.stat(targetPath);
      if (!stats.isFile()) {
        throw new import_shared2.ToolError(`${args.path} is not a file`);
      }
      if (context.limits.maxBytes && stats.size > context.limits.maxBytes) {
        throw new import_shared2.ToolError(`File exceeds maximum allowed size of ${context.limits.maxBytes} bytes`);
      }
      const content = await fs2.readFile(targetPath, "utf-8");
      const crypto3 = await import("crypto");
      const hash = crypto3.createHash("sha256").update(content).digest("hex");
      return { content, hash };
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new import_shared2.ToolError(`Failed to read file: ${e}`);
    }
  }
};

// src/list_directory.ts
var import_shared3 = require("@comu/shared");
var fs3 = __toESM(require("fs/promises"));
var ListDirectoryTool = {
  name: "list_directory",
  description: "Lists the contents of a directory within the workspace",
  capabilities: ["read"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" }
    },
    required: ["path"]
  },
  execute: async (args, context) => {
    try {
      const targetPath = resolveAndVerifyPath(args.path, context.workspace.rootPath);
      const entries = await fs3.readdir(targetPath, { withFileTypes: true });
      let results = entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
        isSymlink: e.isSymbolicLink()
      }));
      if (context.limits.maxResults && results.length > context.limits.maxResults) {
        results = results.slice(0, context.limits.maxResults);
      }
      return results;
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new import_shared3.ToolError(`Failed to list directory: ${e}`);
    }
  }
};

// src/get_workspace_tree.ts
var import_shared4 = require("@comu/shared");
var fs4 = __toESM(require("fs/promises"));
var path2 = __toESM(require("path"));
var GetWorkspaceTreeTool = {
  name: "get_workspace_tree",
  description: "Gets a visual tree representation of the workspace or a subdirectory",
  capabilities: ["read"],
  inputSchema: {
    type: "object",
    properties: {
      dir: { type: "string" },
      maxDepth: { type: "number" },
      maxEntries: { type: "number" }
    }
  },
  execute: async (args, context) => {
    const rootPath = args.dir ? resolveAndVerifyPath(args.dir, context.workspace.rootPath) : context.workspace.rootPath;
    const maxDepth = args.maxDepth ?? 3;
    const maxEntries = args.maxEntries ?? context.limits.maxResults ?? 1e3;
    let entriesCount = 0;
    let isTruncated = false;
    const ignoreList = /* @__PURE__ */ new Set([".git", "node_modules", "dist", "build", ".next", "out", "coverage"]);
    async function walk(currentPath, depth, prefix) {
      if (depth > maxDepth) return "";
      if (entriesCount >= maxEntries) {
        isTruncated = true;
        return "";
      }
      let entries;
      try {
        entries = await fs4.readdir(currentPath, { withFileTypes: true });
      } catch (e) {
        return `${prefix}[Error reading dir]
`;
      }
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
      let output = "";
      for (let i = 0; i < entries.length; i++) {
        if (entriesCount >= maxEntries) {
          isTruncated = true;
          break;
        }
        const entry = entries[i];
        if (ignoreList.has(entry.name)) continue;
        entriesCount++;
        const isLast = i === entries.length - 1;
        const pointer = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
        output += `${prefix}${pointer}${entry.name}${entry.isDirectory() ? "/" : ""}
`;
        if (entry.isDirectory()) {
          const newPrefix = prefix + (isLast ? "    " : "\u2502   ");
          output += await walk(path2.join(currentPath, entry.name), depth + 1, newPrefix);
        }
      }
      return output;
    }
    try {
      let tree = path2.basename(rootPath) + "/\n";
      tree += await walk(rootPath, 1, "");
      if (isTruncated) {
        tree += `
... additional entries omitted due to limits`;
      }
      return { tree, truncated: isTruncated };
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new import_shared4.ToolError(`Failed to generate tree: ${e}`);
    }
  }
};

// src/write_file.ts
var import_shared5 = require("@comu/shared");
var fs5 = __toESM(require("fs/promises"));
var crypto = __toESM(require("crypto"));
var CreateFileTool = {
  name: "create_file",
  description: "Creates a new file. Fails if the file already exists.",
  capabilities: ["write"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" }
    },
    required: ["path", "content"]
  },
  execute: async (args, context) => {
    try {
      const targetPath = resolveAndVerifyPath(args.path, context.workspace.rootPath);
      try {
        await fs5.access(targetPath);
        throw new import_shared5.ToolError(`File already exists at ${args.path}. Use write_file to overwrite or edit_file to modify.`);
      } catch (e) {
        if (e instanceof import_shared5.ToolError) throw e;
      }
      await fs5.writeFile(targetPath, args.content, "utf-8");
      const hash = crypto.createHash("sha256").update(args.content).digest("hex");
      return { success: true, hash };
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new import_shared5.ToolError(`Failed to create file: ${e}`);
    }
  }
};
var WriteFileTool = {
  name: "write_file",
  description: "Overwrites a file completely. Supports expectedHash for concurrency control.",
  capabilities: ["write"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      expectedHash: { type: "string" }
    },
    required: ["path", "content"]
  },
  execute: async (args, context) => {
    try {
      const targetPath = resolveAndVerifyPath(args.path, context.workspace.rootPath);
      if (args.expectedHash) {
        try {
          const existingContent = await fs5.readFile(targetPath, "utf-8");
          const existingHash = crypto.createHash("sha256").update(existingContent).digest("hex");
          if (existingHash !== args.expectedHash) {
            throw new import_shared5.ToolError(`CONFLICT: The file at ${args.path} has been modified since it was last read. Expected hash: ${args.expectedHash}, Current hash: ${existingHash}`);
          }
        } catch (e) {
          if (e.code !== "ENOENT") {
            if (e instanceof import_shared5.ToolError) throw e;
          } else {
            throw new import_shared5.ToolError(`CONFLICT: The file at ${args.path} does not exist but a hash was expected.`);
          }
        }
      }
      await fs5.writeFile(targetPath, args.content, "utf-8");
      const hash = crypto.createHash("sha256").update(args.content).digest("hex");
      return { success: true, hash };
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new import_shared5.ToolError(`Failed to write file: ${e}`);
    }
  }
};

// src/edit_file.ts
var import_shared6 = require("@comu/shared");
var fs6 = __toESM(require("fs/promises"));
var crypto2 = __toESM(require("crypto"));
var EditFileTool = {
  name: "edit_file",
  description: "Applies deterministic exact-match search-and-replace edits to a file.",
  capabilities: ["write"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      expectedHash: { type: "string" },
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            oldText: { type: "string" },
            newText: { type: "string" }
          },
          required: ["oldText", "newText"]
        }
      }
    },
    required: ["path", "edits"]
  },
  execute: async (args, context) => {
    try {
      const targetPath = resolveAndVerifyPath(args.path, context.workspace.rootPath);
      let content = "";
      try {
        content = await fs6.readFile(targetPath, "utf-8");
      } catch (e) {
        throw new import_shared6.ToolError(`Failed to read file for editing: ${e.message}`);
      }
      const existingHash = crypto2.createHash("sha256").update(content).digest("hex");
      if (args.expectedHash && existingHash !== args.expectedHash) {
        throw new import_shared6.ToolError(`CONFLICT: The file at ${args.path} has been modified. Expected hash: ${args.expectedHash}, Current hash: ${existingHash}`);
      }
      for (const edit of args.edits) {
        const occurrences = content.split(edit.oldText).length - 1;
        if (occurrences === 0) {
          throw new import_shared6.ToolError(`Edit failed: oldText not found in file.`);
        }
        if (occurrences > 1) {
          throw new import_shared6.ToolError(`Edit failed: oldText matches multiple times (${occurrences} occurrences). Please provide a more specific oldText block.`);
        }
        content = content.replace(edit.oldText, edit.newText);
      }
      await fs6.writeFile(targetPath, content, "utf-8");
      const newHash = crypto2.createHash("sha256").update(content).digest("hex");
      return { success: true, hash: newHash };
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new import_shared6.ToolError(`Failed to edit file: ${e}`);
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CreateFileTool,
  EditFileTool,
  GetWorkspaceTreeTool,
  ListDirectoryTool,
  ReadFileTool,
  WriteFileTool,
  resolveAndVerifyPath
});
