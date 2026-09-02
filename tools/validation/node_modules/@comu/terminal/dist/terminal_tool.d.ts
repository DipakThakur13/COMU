import { AgentTool, ToolCapability, ToolContext } from '@comu/tool-core';
import { CommandResult } from './command_plan';
export interface ExecuteCommandArgs {
    executable: string;
    args: string[];
    cwd?: string;
}
export declare class TerminalTool implements AgentTool<ExecuteCommandArgs, CommandResult> {
    name: string;
    description: string;
    capabilities: ToolCapability[];
    inputSchema: {
        type: string;
        properties: {
            executable: {
                type: string;
                description: string;
            };
            args: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            cwd: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    private policy;
    private processManager;
    execute(args: ExecuteCommandArgs, context: ToolContext): Promise<CommandResult>;
}
//# sourceMappingURL=terminal_tool.d.ts.map