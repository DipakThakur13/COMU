import { AgentTool, ToolCapability, ToolContext } from '@comu/tool-core';
export interface GitStatusResult {
    isRepository: boolean;
    branch?: string;
    staged: string[];
    modified: string[];
    deleted: string[];
    untracked: string[];
}
export declare class GitStatusTool implements AgentTool<any, GitStatusResult> {
    name: string;
    description: string;
    capabilities: ToolCapability[];
    inputSchema: {
        type: string;
        properties: {};
    };
    private processManager;
    execute(args: any, context: ToolContext): Promise<GitStatusResult>;
}
//# sourceMappingURL=git_status_tool.d.ts.map