import {
  AgentEvent,
  TaskPlan,
  VerificationResult,
  FailureDiagnosis,
  RepairAttempt,
  InteractionRequest,
  InteractionResponse,
  WorkspaceMemoryEntry,
  ProviderConfig,
  ProviderTestResult
} from "@comu/protocol";

export interface ChangeSummary {
  path: string;
  operation: "CREATE" | "MODIFY";
}

export interface SubagentSummaryUI {
  subagentId: string;
  subagentType: string;
  goal: string;
  status: string;
  summary?: string;
  findings?: string;
}

export type WebviewMessage =
  | { type: "ready" }
  | { type: "submit_prompt"; prompt: string; modelId: string; mode?: "AUTO" | "CHAT" | "ASK" | "PLAN" | "AGENT" }
  | { type: "cancel_task" }
  | { type: "request_diff"; path: string }
  | { type: "open_file"; path: string; line?: number }
  | { type: "select_model"; modelId: string }
  | { type: "save_provider_key"; providerId: string; key: string; endpoint?: string }
  | { type: "remove_provider_key"; providerId: string }
  | { type: "test_provider"; providerId: string; key?: string; endpoint?: string }
  | { type: "request_providers" }
  | { type: "open_settings"; targetProviderId?: string }
  | { type: "respond_interaction"; taskId: string; interactionId: string; response: InteractionResponse }
  | { type: "approve_commit"; taskId: string; message?: string }
  | { type: "deny_commit"; taskId: string }
  | { type: "approve_push"; taskId: string; remote?: string; branch?: string }
  | { type: "deny_push"; taskId: string }
  | { type: "request_memory"; workspaceId?: string }
  | { type: "create_convention"; workspaceId: string; content: string }
  | { type: "invalidate_memory"; memoryId: string; workspaceId: string }
  | { type: "telemetry_metric"; name: string; value: number; details?: string };

export type ExtensionMessage =
  | { type: "state_update"; state: ChatSessionStateUI }
  | { type: "error"; message: string }
  | { type: "providers_update"; providers: ProviderConfig[] }
  | { type: "provider_test_result"; providerId: string; result: ProviderTestResult }
  | { type: "open_settings"; targetProviderId?: string }
  | { type: "memory_update"; entries: WorkspaceMemoryEntry[] }
  | { type: "agent_event"; event: AgentEvent };

export interface WorkingSetUI {
  activeFile?: string;
  openFiles?: string[];
  recentlyInspectedFiles?: string[];
  searchResults?: Array<{ file: string; line: number; content: string }>;
  diagnostics?: Array<{ file: string; line: number; message: string; severity: string }>;
  modifiedFiles?: Array<{ path: string; source?: string }>;
}

// UI projection of ChatSessionState
export interface ChatSessionStateUI {
  taskId?: string;
  prompt?: string;
  modelId?: string;
  interactionMode?: "CHAT" | "ASK" | "PLAN" | "AGENT" | "AMBIGUOUS";
  agentState?: string;
  status: "idle" | "running" | "cancelling" | "waiting_for_user" | "completed" | "failed" | "cancelled" | "offline";
  events: AgentEvent[];
  changes: ChangeSummary[];
  finalResponse?: string;
  plan?: TaskPlan;
  verification?: VerificationResult;
  diagnosis?: FailureDiagnosis;
  repairAttempts?: RepairAttempt[];
  pendingInteraction?: InteractionRequest;
  gitCommitProposal?: { message: string; files: string[] };
  gitCommitResult?: { commitHash: string; message: string; branch: string; fileCount: number };
  gitPushProposal?: { remote: string; branch: string; commitHash: string };
  gitPushResult?: { remote: string; branch: string; commitHash: string };
  subagents?: SubagentSummaryUI[];
  memories?: WorkspaceMemoryEntry[];
  workingSet?: WorkingSetUI;
  startTime?: number;
  completedTime?: number;
  durationMs?: number;
  estimatedTokens?: number;
}

