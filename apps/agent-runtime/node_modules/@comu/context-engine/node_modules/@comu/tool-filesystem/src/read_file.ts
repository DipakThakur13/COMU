import { AgentTool, ToolContext } from "@comu/tool-core";
import { resolveAndVerifyPath } from "./security.js";
import { ToolError } from "@comu/shared";
import * as fs from "fs/promises";

export interface ReadFileArgs {
  path: string;
}

export const ReadFileTool: AgentTool<ReadFileArgs, { content: string; hash: string }> = {
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
      const stats = await fs.stat(targetPath);
      
      if (!stats.isFile()) {
        throw new ToolError(`${args.path} is not a file`);
      }

      if (context.limits.maxBytes && stats.size > context.limits.maxBytes) {
        throw new ToolError(`File exceeds maximum allowed size of ${context.limits.maxBytes} bytes`);
      }

      const content = await fs.readFile(targetPath, "utf-8");
      
      const crypto = await import("crypto");
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      
      return { content, hash };
    } catch (e: any) {
      if (e instanceof Error) throw e;
      throw new ToolError(`Failed to read file: ${e}`);
    }
  }
};
