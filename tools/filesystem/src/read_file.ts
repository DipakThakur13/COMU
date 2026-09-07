import { AgentTool, ToolContext } from "@comu/tool-core";
import { resolveAndVerifyPath } from "./security.js";
import { ToolError } from "@comu/shared";
import * as fs from "fs/promises";

export interface ReadFileArgs {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface ReadFileResult {
  content: string;
  hash: string;
  path: string;
  size: number;
  lineCount: number;
  truncated: boolean;
  startLine?: number;
  endLine?: number;
}

export const ReadFileTool: AgentTool<ReadFileArgs, ReadFileResult> = {
  name: "read_file",
  description: "Reads the contents of a file within the workspace, optionally bounded by 1-indexed startLine and endLine",
  capabilities: ["read"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      startLine: { type: "number", description: "1-indexed starting line number" },
      endLine: { type: "number", description: "1-indexed ending line number" }
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

      const rawContent = await fs.readFile(targetPath, "utf-8");
      
      const crypto = await import("crypto");
      const hash = crypto.createHash("sha256").update(rawContent).digest("hex");

      const lines = rawContent.split(/\r?\n/);
      const totalLines = lines.length;

      let returnContent = rawContent;
      let truncated = false;
      let startLine = args.startLine;
      let endLine = args.endLine;

      if (startLine !== undefined || endLine !== undefined) {
        const start = Math.max(1, startLine || 1);
        const end = Math.min(totalLines, endLine || totalLines);
        returnContent = lines.slice(start - 1, end).join("\n");
        truncated = (end - start + 1) < totalLines;
        startLine = start;
        endLine = end;
      }
      
      return { 
        content: returnContent, 
        hash,
        path: args.path,
        size: stats.size,
        lineCount: totalLines,
        truncated,
        startLine,
        endLine
      };
    } catch (e: any) {
      if (e instanceof Error) throw e;
      throw new ToolError(`Failed to read file: ${e}`);
    }
  }
};
