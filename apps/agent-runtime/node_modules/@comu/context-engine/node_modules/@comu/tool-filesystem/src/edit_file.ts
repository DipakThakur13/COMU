import { AgentTool } from "@comu/tool-core";
import { resolveAndVerifyPath } from "./security.js";
import { ToolError } from "@comu/shared";
import * as fs from "fs/promises";
import * as crypto from "crypto";

export interface EditFileInput {
  path: string;
  edits: Array<{
    oldText: string;
    newText: string;
  }>;
  expectedHash?: string;
}

export const EditFileTool: AgentTool<EditFileInput, { success: boolean; hash: string }> = {
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
        content = await fs.readFile(targetPath, "utf-8");
      } catch (e: any) {
        throw new ToolError(`Failed to read file for editing: ${e.message}`);
      }

      const existingHash = crypto.createHash("sha256").update(content).digest("hex");
      if (args.expectedHash && existingHash !== args.expectedHash) {
        throw new ToolError(`CONFLICT: The file at ${args.path} has been modified. Expected hash: ${args.expectedHash}, Current hash: ${existingHash}`);
      }

      for (const edit of args.edits) {
        const occurrences = content.split(edit.oldText).length - 1;
        if (occurrences === 0) {
          throw new ToolError(`Edit failed: oldText not found in file.`);
        }
        if (occurrences > 1) {
          throw new ToolError(`Edit failed: oldText matches multiple times (${occurrences} occurrences). Please provide a more specific oldText block.`);
        }

        content = content.replace(edit.oldText, edit.newText);
      }

      await fs.writeFile(targetPath, content, "utf-8");
      const newHash = crypto.createHash("sha256").update(content).digest("hex");
      
      return { success: true, hash: newHash };
    } catch (e: any) {
      if (e instanceof Error) throw e;
      throw new ToolError(`Failed to edit file: ${e}`);
    }
  }
};
