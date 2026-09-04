import { AgentTool, ToolContext } from "@comu/tool-core";
import { resolveAndVerifyPath } from "./security.js";
import { ToolError } from "@comu/shared";
import * as fs from "fs/promises";
import * as path from "path";

export interface GetWorkspaceTreeArgs {
  dir?: string;
  maxDepth?: number;
  maxEntries?: number;
}

export interface WorkspaceTreeResult {
  tree: string;
  truncated: boolean;
}

export const GetWorkspaceTreeTool: AgentTool<GetWorkspaceTreeArgs, WorkspaceTreeResult> = {
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
    const maxEntries = args.maxEntries ?? context.limits.maxResults ?? 1000;
    
    let entriesCount = 0;
    let isTruncated = false;
    const ignoreList = new Set([".git", "node_modules", "dist", "build", ".next", "out", "coverage"]);

    async function walk(currentPath: string, depth: number, prefix: string): Promise<string> {
      if (depth > maxDepth) return "";
      if (entriesCount >= maxEntries) {
        isTruncated = true;
        return "";
      }

      let entries;
      try {
        entries = await fs.readdir(currentPath, { withFileTypes: true });
      } catch (e) {
        return `${prefix}[Error reading dir]\n`;
      }

      // Sort: directories first, then files, alphabetically
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
        const pointer = isLast ? "└── " : "├── ";
        
        output += `${prefix}${pointer}${entry.name}${entry.isDirectory() ? "/" : ""}\n`;

        if (entry.isDirectory()) {
          const newPrefix = prefix + (isLast ? "    " : "│   ");
          output += await walk(path.join(currentPath, entry.name), depth + 1, newPrefix);
        }
      }
      return output;
    }

    try {
      let tree = path.basename(rootPath) + "/\n";
      tree += await walk(rootPath, 1, "");
      
      if (isTruncated) {
        tree += `\n... additional entries omitted due to limits`;
      }
      
      return { tree, truncated: isTruncated };
    } catch (e: any) {
      if (e instanceof Error) throw e;
      throw new ToolError(`Failed to generate tree: ${e}`);
    }
  }
};
