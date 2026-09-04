import {
  AgentEvent,
  TaskPlan,
  VerificationResult,
  FailureDiagnosis,
  RepairAttempt,
  InteractionRequest,
  InteractionResponse,
  WorkspaceMemoryEntry
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
  | { type: "submit_prompt"; prompt: string; modelId: string }
  | { type: "cancel_task" }
  | { type: "request_diff"; path: string }
  | { type: "select_model"; modelId: string }
  | { type: "save_provider_key"; providerId: string; key: string }
  | { type: "remove_provider_key"; providerId: string }
  | { type: "test_provider"; providerId: string }
  | { type: "request_providers" }
  | { type: "respond_interaction"; taskId: string; interactionId: string; response: InteractionResponse }
  | { type: "approve_commit"; taskId: string; message?: string }
  | { type: "deny_commit"; taskId: string }
  | { type: "approve_push"; taskId: string; remote?: string; branch?: string }
  | { type: "deny_push"; taskId: string }
  | { type: "request_memory"; workspaceId?: string }
  | { type: "create_convention"; workspaceId: string; content: string }
  | { type: "invalidate_memory"; memoryId: string; workspaceId: string };

export type ExtensionMessage =
  | { type: "state_update"; state: ChatSessionStateUI }
  | { type: "error"; message: string }
  | { type: "providers_update"; providers: any[] }
  | { type: "memory_update"; entries: WorkspaceMemoryEntry[] }
  | { type: "agent_event"; event: AgentEvent };

// UI projection of ChatSessionState
export interface ChatSessionStateUI {
  taskId?: string;
  prompt?: string;
  modelId?: string;
  status: "idle" | "running" | "waiting_for_user" | "completed" | "failed" | "cancelled" | "offline";
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
}
