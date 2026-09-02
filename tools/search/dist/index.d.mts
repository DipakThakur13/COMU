import { ToolContext, AgentTool } from '@comu/tool-core';

interface SearchResult {
    path: string;
    line: number;
    column?: number;
    preview: string;
}
interface SearchTextResult {
    matches: SearchResult[];
    truncated: boolean;
}
interface SearchQuery {
    query: string;
    isRegex?: boolean;
    caseSensitive?: boolean;
}
interface SearchBackend {
    search(query: SearchQuery, context: ToolContext): Promise<SearchTextResult>;
}

interface SearchTextArgs {
    query: string;
    isRegex?: boolean;
    caseSensitive?: boolean;
}
declare const SearchTextTool: AgentTool<SearchTextArgs, SearchTextResult>;

declare class NodeRecursiveSearchBackend implements SearchBackend {
    private isBinaryString;
    search(query: SearchQuery, context: ToolContext): Promise<SearchTextResult>;
}

export { NodeRecursiveSearchBackend, type SearchBackend, type SearchQuery, type SearchResult, type SearchTextArgs, type SearchTextResult, SearchTextTool };
