export type ToolCapability = "read" | "write" | "execute" | "network";

export type PermissionDecision = "ALLOW" | "DENY" | "ASK_USER";

export interface ToolPermissions {
  capabilities: Record<ToolCapability, PermissionDecision>;
}

export interface CancellationSignal {
  isCancelled: boolean;
  onCancel: (callback: () => void) => void;
}

export interface ToolContext {
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

export interface AgentTool<TArgs = any, TResult = any> {
  name: string;
  description: string;
  capabilities: ToolCapability[];
  inputSchema: any; // JSON Schema for arguments
  execute(args: TArgs, context: ToolContext): Promise<TResult>;
}
