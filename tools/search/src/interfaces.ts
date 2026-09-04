import { ToolContext } from "@comu/tool-core";

export interface SearchResult {
  path: string;
  line: number;
  column?: number;
  preview: string;
}

export interface SearchTextResult {
  matches: SearchResult[];
  truncated: boolean;
}

export interface SearchQuery {
  query: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
}

export interface SearchBackend {
  search(query: SearchQuery, context: ToolContext): Promise<SearchTextResult>;
}
