import { AgentTool } from "@comu/tool-core";
import { resolveAndVerifyPath } from "./security.js";
import { ToolError } from "@comu/shared";
import * as fs from "fs/promises";
import * as crypto from "crypto";

export interface CreateFileArgs {
  path: string;
  content: string;
}

export const CreateFileTool: AgentTool<CreateFileArgs, { success: boolean; hash: string }> = {
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
        await fs.access(targetPath);
        throw new ToolError(`File already exists at ${args.path}. Use write_file to overwrite or edit_file to modify.`);
      } catch (e: any) {
        if (e instanceof ToolError) throw e;
        // Proceed if file doesn't exist
      }

      await fs.writeFile(targetPath, args.content, "utf-8");
      const hash = crypto.createHash("sha256").update(args.content).digest("hex");
      return { success: true, hash };
    } catch (e: any) {
      if (e instanceof Error) throw e;
      throw new ToolError(`Failed to create file: ${e}`);
    }
  }
};

export interface WriteFileArgs {
  path: string;
  content: string;
  expectedHash?: string;
}

export const WriteFileTool: AgentTool<WriteFileArgs, { success: boolean; hash: string }> = {
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
          const existingContent = await fs.readFile(targetPath, "utf-8");
          const existingHash = crypto.createHash("sha256").update(existingContent).digest("hex");
          if (existingHash !== args.expectedHash) {
            throw new ToolError(`CONFLICT: The file at ${args.path} has been modified since it was last read. Expected hash: ${args.expectedHash}, Current hash: ${existingHash}`);
          }
        } catch (e: any) {
          if (e.code !== "ENOENT") { // If ENOENT, it doesn't exist, so there's no hash conflict per se, but wait, if they expected a hash, it must exist.
            if (e instanceof ToolError) throw e;
          } else {
             throw new ToolError(`CONFLICT: The file at ${args.path} does not exist but a hash was expected.`);
          }
        }
      }

      await fs.writeFile(targetPath, args.content, "utf-8");
      const hash = crypto.createHash("sha256").update(args.content).digest("hex");
      return { success: true, hash };
    } catch (e: any) {
      if (e instanceof Error) throw e;
      throw new ToolError(`Failed to write file: ${e}`);
    }
  }
};
