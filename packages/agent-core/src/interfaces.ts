import {
  AgentEvent,
  AgentLimits,
  TaskMode,
  TaskAutonomy,
  TaskPlan,
  VerificationResult,
  FailureDiagnosis,
  RepairAttempt,
  WorkspaceIntegrityResult
} from "@comu/protocol";

export type AgentState =
  | "IDLE"
  | "STARTING"
  | "CLASSIFYING"
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
  /** User-selected interaction mode. Omitted or AUTO means the kernel classifies the prompt. */
  mode?: TaskMode;
  /** Autonomy level. Omitted means ask: every write or command needs a human decision. */
  autonomy?: TaskAutonomy;
  systemPrompt: string;
  userPrompt: string;
  limits: AgentLimits;
  onEvent: (event: AgentEvent) => void;
  abortSignal?: AbortSignal;
  /**
   * Reports whether a human can currently see this task (an event stream subscriber is attached).
   * When it returns false, approvals are denied immediately instead of blocking a headless run.
   */
  hasHumanObserver?: () => boolean;
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

