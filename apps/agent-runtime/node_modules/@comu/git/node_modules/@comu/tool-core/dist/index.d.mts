type ToolCapability = "read" | "write" | "execute" | "network";
type PermissionDecision = "ALLOW" | "DENY" | "ASK_USER";
interface ToolPermissions {
    capabilities: Record<ToolCapability, PermissionDecision>;
}
interface CancellationSignal {
    isCancelled: boolean;
    onCancel: (callback: () => void) => void;
}
interface ToolContext {
    taskId: string;
    workspace: {
        rootPath: string;
    };
    cancellation?: CancellationSignal;
    limits: {
        maxResults?: number;
        maxBytes?: number;
        timeoutMs?: number;
        maxCommandTimeoutMs?: number;
        maxStdoutBytes?: number;
        maxStderrBytes?: number;
        maxCombinedOutputBytes?: number;
        maxConcurrentProcesses?: number;
    };
    permissions?: ToolPermissions;
}
interface AgentTool<TArgs = any, TResult = any> {
    name: string;
    description: string;
    capabilities: ToolCapability[];
    inputSchema: any;
    execute(args: TArgs, context: ToolContext): Promise<TResult>;
}

declare class ToolRegistry {
    private tools;
    register(tool: AgentTool): void;
    get(name: string): AgentTool;
    getAll(): AgentTool[];
}

declare class ToolExecutor {
    private registry;
    constructor(registry: ToolRegistry);
    execute<TArgs, TResult>(toolName: string, args: TArgs, context: ToolContext): Promise<TResult>;
}

export { type AgentTool, type CancellationSignal, type PermissionDecision, type ToolCapability, type ToolContext, ToolExecutor, type ToolPermissions, ToolRegistry };
