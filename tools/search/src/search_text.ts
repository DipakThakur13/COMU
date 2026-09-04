import { AgentTool, ToolContext } from "@comu/tool-core";
import { SearchBackend, SearchTextResult } from "./interfaces.js";
import { NodeRecursiveSearchBackend } from "./backends/node_recursive.js";
import { ToolError } from "@comu/shared";

export interface SearchTextArgs {
  query: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
}

// In the future, this backend could be configurable or auto-detected (e.g. using RipgrepSearchBackend if rg is installed)
const defaultBackend: SearchBackend = new NodeRecursiveSearchBackend();

export const SearchTextTool: AgentTool<SearchTextArgs, SearchTextResult> = {
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
    } catch (e: any) {
      throw new ToolError(`Search failed: ${e.message}`);
    }
  }
};
