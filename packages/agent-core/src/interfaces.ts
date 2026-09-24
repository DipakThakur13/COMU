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
import type { TurnContext } from "@comu/session-store";

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
  /**
   * The session this turn belongs to: the working state, the recent turns and the last change.
   * Absent for the first turn of a session, which is built exactly as a single task always was.
   * Read here, never written: the host records the turn in the session after the task ends, and
   * nothing from it goes into the memory engine.
   */
  session?: TurnContext;
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

