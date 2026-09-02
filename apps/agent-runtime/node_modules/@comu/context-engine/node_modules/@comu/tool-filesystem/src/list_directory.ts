import { AgentTool, ToolContext } from "@comu/tool-core";
import { resolveAndVerifyPath } from "./security.js";
import { ToolError } from "@comu/shared";
import * as fs from "fs/promises";

export interface ListDirectoryArgs {
  path: string;
}

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

export const ListDirectoryTool: AgentTool<ListDirectoryArgs, DirectoryEntry[]> = {
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
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      
      let results = entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
        isSymlink: e.isSymbolicLink()
      }));
      
      if (context.limits.maxResults && results.length > context.limits.maxResults) {
        results = results.slice(0, context.limits.maxResults);
      }
      
      return results;
    } catch (e: any) {
      if (e instanceof Error) throw e;
      throw new ToolError(`Failed to list directory: ${e}`);
    }
  }
};
