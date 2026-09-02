import { AgentTool, ToolCapability, ToolContext } from '@comu/tool-core';
export interface GitDiffArgs {
    staged?: boolean;
    file?: string;
}
export interface GitDiffResult {
    diff: string;
    truncated: boolean;
}
export declare class GitDiffTool implements AgentTool<GitDiffArgs, GitDiffResult> {
    name: string;
    description: string;
    capabilities: ToolCapability[];
    inputSchema: {
        type: string;
        properties: {
            staged: {
                type: string;
                description: string;
            };
            file: {
                type: string;
                description: string;
            };
        };
    };
    private processManager;
    execute(args: GitDiffArgs, context: ToolContext): Promise<GitDiffResult>;
}
//# sourceMappingURL=git_diff_tool.d.ts.map