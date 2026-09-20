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
  runId?: string;
  stepId?: string;
  workspace: {
    rootPath: string;
  };
  abortSignal?: AbortSignal;
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
  onTrace?: (
    eventType: "TOOL_REQUEST" | "TOOL_STARTED" | "TOOL_COMPLETED" | "TOOL_FAILED" | "VALIDATION_STARTED" | "VALIDATION_COMPLETED",
    toolCallId?: string
  ) => void;
}

/**
 * "always": a human must approve every call regardless of autonomy (git push).
 * "byAutonomy" (default): approval is required only when the autonomy level says so.
 */
export type ToolApprovalRequirement = "always" | "byAutonomy";

export interface AgentTool<TArgs = any, TResult = any> {
  name: string;
  description: string;
  capabilities: ToolCapability[];
  requiresApproval?: ToolApprovalRequirement;
  inputSchema: any; // JSON Schema for arguments
  execute(args: TArgs, context: ToolContext): Promise<TResult>;
}
