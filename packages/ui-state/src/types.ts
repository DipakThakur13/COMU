import {
  AgentEvent,
  ApprovalDecidedEvent,
  ApprovalPayload,
  FailureDiagnosis,
  InteractionRequest,
  RepairAttempt,
  TaskAutonomy,
  TaskMode,
  VerificationResult,
  VerificationStatus,
  WorkspaceMemoryEntry
} from "@comu/protocol";

export type InteractionMode = "CHAT" | "ASK" | "PLAN" | "AGENT" | "AMBIGUOUS";

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

export type SessionStatus =
  | "idle"
  | "running"
  | "waiting_for_user"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type ConnectionState = "connecting" | "online" | "offline";

export type ActivityCategory =
  | "AGENT_MESSAGE"
  | "TOOL_ACTIVITY"
  | "COMMAND_OUTPUT"
  | "VALIDATION"
  | "DIAGNOSIS"
  | "REPAIR"
  | "APPROVAL"
  | "SYSTEM_EVENT";

export type ToolCategory =
  | "Read"
  | "Explore"
  | "Search"
  | "Edit"
  | "Write"
  | "Create"
  | "Terminal"
  | "Git"
  | "Verification"
  | "Diagnosis"
  | "Repair"
  | "Worker"
  | "Generic";

export type ActivityStatus = "completed" | "active" | "pending" | "warning" | "failed";

/**
 * How loudly a row speaks.
 *
 * The stream used to give a failure, an edit and a directory listing the same grey dot, so the one
 * row a person needed was the hardest to find. Every row now declares which of three levels it
 * belongs to and the interface renders each level differently:
 *
 * - `outcome`  — the task finished, failed, or is blocked on a person. Bordered, unmissable.
 * - `substance`— work that changed something or decided something: edits, commands, verification.
 * - `routine`  — looking around: reads, searches, directory listings. Dimmed, and folded into
 *                counts when consecutive.
 */
export type ActivityLevel = "outcome" | "substance" | "routine";

export interface ActivityItem {
  id: string;
  category: ActivityCategory;
  toolCategory?: ToolCategory;
  level: ActivityLevel;
  status: ActivityStatus;
  title: string;
  shortDescription?: string;
  /**
   * The row's one measurement, shown right-aligned: "+12 −3", "2 failed", "18 matches".
   *
   * Undefined when there is nothing to measure. A slot that renders "unknown" is worse than no
   * slot, so there is no placeholder value here and never an empty string.
   */
  metric?: string;
  timestamp: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export interface ActivityGroup {
  id: string;
  isGroup: true;
  category: ActivityCategory;
  toolCategory: ToolCategory;
  level: ActivityLevel;
  status: ActivityStatus;
  title: string;
  shortDescription?: string;
  metric?: string;
  items: ActivityItem[];
  timestamp: string;
}

export type ActivityEntry = ActivityItem | ActivityGroup;

export function isActivityGroup(entry: ActivityEntry): entry is ActivityGroup {
  return (entry as ActivityGroup).isGroup === true;
}

export interface PlanStepView {
  id: string;
  type: string;
  title: string;
  description?: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED" | "SKIPPED";
  resultSummary?: string;
}

export interface PlanView {
  planId: string;
  version: number;
  goal: string;
  steps: PlanStepView[];
  /** Index of the running step, or the next pending one; -1 when the plan is done. */
  currentIndex: number;
  completedCount: number;
}

/**
 * A file the task has already written. Approval happens before the write, so by the time a change
 * appears here it is on disk. There is deliberately no `decision` field: marking a change
 * "rejected" without reverting it from the change set's original content would imply an undo the
 * product does not perform. Revert belongs with the aggregate review view and is its own work.
 */
export interface ChangeView {
  path: string;
  operation: "CREATE" | "MODIFY";
  additions?: number;
  deletions?: number;
}

export interface WorkerView {
  subagentId: string;
  subagentType: string;
  goal?: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "LIMIT_REACHED";
  summary?: string;
  /** Live text for this worker's current turn. Worker deltas never enter the main stream. */
  streamText?: string;
}

/**
 * The files this task has looked at and the files it has changed.
 *
 * Derived from the same events everything else is derived from, so it needs nothing new from the
 * runtime. Inspected files are newest first and bounded: the point is "what is COMU working on
 * right now", which a hundred-entry list stops answering.
 */
export interface WorkingSetView {
  inspectedFiles: string[];
  modifiedFiles: string[];
}

export const MAX_INSPECTED_FILES = 20;

export interface ApprovalView {
  interactionId: string;
  taskId: string;
  title: string;
  message: string;
  payload?: ApprovalPayload;
  createdAt: string;
  expiresAt: string;
}

/**
 * What is happening right now.
 *
 * "Thinking", "Executing tools" and "Observing results" are not events: they are the absence of
 * one. They belong in a single line that updates in place and disappears when the task ends, not
 * in a history that keeps every state the loop passed through. Nothing here is ever appended to
 * the activity stream.
 */
export interface LiveStatus {
  /** One phrase, in words a person would use: "Thinking", "Reading login.ts", "Running npm test". */
  label: string;
  /** When this phase began, so the line can count up without the reducer holding a clock. */
  startedAt: string;
}

/** The assistant's turn as it is being generated. Folded into the activity stream when it ends. */
export interface StreamingView {
  requestId: string;
  text: string;
  reasoning: string;
  /** Highest index seen per kind; a jump means a delta was dropped. */
  lastIndex: { text: number; reasoning: number };
  startedAt: string;
}

export interface UsageView {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
  /** Undefined when any model in the run has no known price: COMU never invents a cost. */
  costUsd?: number;
  costKnown: boolean;
}

export interface TimingView {
  startedAt?: number;
  endedAt?: number;
  /** Time the task spent blocked on a human decision, excluded from the execution budget. */
  waitingMs: number;
}

export interface ErrorView {
  code: string;
  message: string;
  hint?: string;
}

/**
 * Replication bookkeeping. The extension host is authoritative; the webview holds a replica built
 * from a snapshot plus a contiguous run of sequenced events. A gap means the replica is no longer
 * trustworthy and a fresh snapshot must be requested.
 */
export interface ReplicationView {
  /** Sequence of the last event applied. -1 before the first snapshot. */
  lastSeq: number;
  /** True when a gap was detected; the consumer must request a snapshot. */
  needsResync: boolean;
  /** Sequence that arrived out of order, for diagnostics. */
  gapAt?: number;
}

export interface SessionState {
  taskId?: string;
  prompt?: string;
  modelId?: string;
  connection: ConnectionState;
  status: SessionStatus;
  agentState: AgentState;
  mode?: InteractionMode;
  modeSource?: "explicit" | "deterministic" | "context" | "model" | "fallback";
  autonomy: TaskAutonomy;

  plan?: PlanView;
  activity: ActivityEntry[];
  /** Activity items dropped from the front once the cap was reached. */
  elidedCount: number;
  streaming?: StreamingView;
  /** The live status line. Undefined whenever the task is not running. */
  live?: LiveStatus;
  /** The limit the runtime reported, so the outcome can say why in plain language. */
  limit?: string;

  changes: ChangeView[];
  workingSet: WorkingSetView;
  pendingApproval?: ApprovalView;
  /** Every approval decision, including session grants and automatic denials. */
  approvals: ApprovalDecidedEvent[];
  pendingInteraction?: InteractionRequest;

  verification?: VerificationResult;
  diagnosis?: FailureDiagnosis;
  repairs: RepairAttempt[];
  workers: WorkerView[];
  memory: WorkspaceMemoryEntry[];

  usage: UsageView;
  timing: TimingView;
  finalText?: string;
  /**
   * What verification established for the completion, from task.completed. NOT_VERIFIED completes
   * but must never be shown as a verified completion.
   */
  completedVerification?: VerificationStatus;
  error?: ErrorView;

  /**
   * Bounded, serialisable dedupe window. An array rather than a Set because the snapshot crosses
   * postMessage; oldest ids are dropped once the window is full.
   */
  seenEventIds: string[];
  replication: ReplicationView;
}

/** An event with the host-assigned sequence number that makes gap detection possible. */
export interface SequencedEvent {
  seq: number;
  event: AgentEvent;
}

export interface UiState {
  surface: "activity" | "changes";
  drawer?: "overview" | "verification" | "memory" | "workers" | "context";
  settingsOpen: boolean;
  composer: {
    text: string;
    mode: TaskMode;
    autonomy: TaskAutonomy;
    modelId?: string;
  };
  expandedActivityIds: string[];
  showElided: boolean;
}

export const MAX_ACTIVITY_ENTRIES = 5000;
export const MAX_SEEN_EVENT_IDS = 2000;
export const MAX_STREAM_CHARS = 200_000;
