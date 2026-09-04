import {
  AgentEvent,
  AgentLimits,
  TaskPlan,
  VerificationResult,
  FailureDiagnosis,
  RepairAttempt,
  WorkspaceIntegrityResult
} from "@comu/protocol";

export type AgentState =
  | "IDLE"
  | "STARTING"
  | "ANALYZING"
  | "PLANNING"
  | "THINKING"
  | "TOOL_CALLING"
  | "OBSERVING"
  | "VERIFYING"
  | "DIAGNOSING"
  | "REPAIRING"
  | "WAITING_FOR_USER"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "LIMIT_REACHED";

export interface OrchestratorContext {
  taskId: string;
  workspaceRoot: string;
  workspaceId?: string;
  systemPrompt: string;
  userPrompt: string;
  limits: AgentLimits;
  onEvent: (event: AgentEvent) => void;
  abortSignal?: AbortSignal;
  gitConfig?: {
    autoCommitVerifiedTasks?: boolean;
    autoBranchOnTask?: boolean;
    remote?: string;
    branch?: string;
  };
}

export interface AgentResult {
  status: "completed" | "failed" | "cancelled" | "limit_reached" | "waiting_for_user";
  finalText?: string;
  error?: string;
  steps: number;
  changeSet?: any;
  plan?: TaskPlan;
  verificationResult?: VerificationResult;
  diagnosis?: FailureDiagnosis;
  repairAttempts?: RepairAttempt[];
  workspaceIntegrity?: WorkspaceIntegrityResult;
  gitCommitResult?: any;
  gitPushResult?: any;
}

