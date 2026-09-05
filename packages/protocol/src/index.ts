export interface SelectionContext {
  filePath: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  text: string;
}

export interface TaskRequest {
  taskId: string;
  prompt: string;
  modelId: string;
  workspace: {
    rootPath: string;
    workspaceId?: string;
  };
  editor?: {
    activeFile?: string;
    openFiles?: string[];
    selection?: SelectionContext;
  };
}

export type TraceEventType =
  | "MODEL_REQUEST"
  | "MODEL_RESPONSE"
  | "TOOL_REQUEST"
  | "TOOL_STARTED"
  | "TOOL_COMPLETED"
  | "TOOL_FAILED"
  | "VALIDATION_STARTED"
  | "VALIDATION_COMPLETED"
  | "STATE_CHANGED";

export interface ExecutionTraceEvent extends AgentEventBase {
  type: "execution.trace";
  runId: string;
  stepId: string;
  toolCallId?: string;
  eventType: TraceEventType;
}

export interface ModelRequestEventBase extends AgentEventBase {
  requestId: string;
  runId: string;
  attempt: number;
}

export interface ModelRequestCreatedEvent extends ModelRequestEventBase {
  type: "model_request.created";
}

export interface ModelRequestStartedEvent extends ModelRequestEventBase {
  type: "model_request.started";
}

export interface ModelRequestSucceededEvent extends ModelRequestEventBase {
  type: "model_request.succeeded";
  latencyMs: number;
}

export interface ModelRequestFailedEvent extends ModelRequestEventBase {
  type: "model_request.failed";
  error: string;
}

export interface ModelRequestTimedOutEvent extends ModelRequestEventBase {
  type: "model_request.timed_out";
  timeoutMs: number;
}

export interface ModelRequestCancelledEvent extends ModelRequestEventBase {
  type: "model_request.cancelled";
}

export interface ModelRequestRetryingEvent extends ModelRequestEventBase {
  type: "model_request.retrying";
  delayMs: number;
  nextAttempt: number;
}

export interface AgentEventBase {
  type: string;
  eventId: string;
  taskId: string;
  timestamp: string;
}

export interface TaskStartedEvent extends AgentEventBase {
  type: "task.started";
}

export interface AgentStatusEvent extends AgentEventBase {
  type: "agent.status";
  status: string;
}

export interface ToolStartedEvent extends AgentEventBase {
  type: "tool.started";
  tool: string;
}

export interface ToolCompletedEvent extends AgentEventBase {
  type: "tool.completed";
  tool: string;
  result?: any;
}

export interface ChangeCreatedEvent extends AgentEventBase {
  type: "change.created";
  path: string;
  operation: "CREATE" | "MODIFY";
}

export interface TaskCompletedEvent extends AgentEventBase {
  type: "task.completed";
  finalText?: string;
}

export interface TaskFailedEvent extends AgentEventBase {
  type: "task.failed";
  error: string;
  payload?: {
    code: string;
    message: string;
  };
}

export interface TaskCancelledEvent extends AgentEventBase {
  type: "task.cancelled";
}

export interface AgentLimitReachedEvent extends AgentEventBase {
  type: "agent.limit_reached";
  limit: string;
}

export interface CommandStartedEvent extends AgentEventBase {
  type: "command.started";
  commandId: string;
}

export interface CommandCompletedEvent extends AgentEventBase {
  type: "command.completed";
  commandId: string;
}

export interface CommandFailedEvent extends AgentEventBase {
  type: "command.failed";
  commandId: string;
}

export interface CommandTimeoutEvent extends AgentEventBase {
  type: "command.timeout";
  commandId: string;
}

export interface CommandCancelledEvent extends AgentEventBase {
  type: "command.cancelled";
  commandId: string;
}

// ==========================================
// Milestone 6: Plan Types
// ==========================================

export type PlanStepType =
  | "INVESTIGATE"
  | "IMPLEMENT"
  | "VALIDATE"
  | "DIAGNOSE"
  | "REPAIR"
  | "USER_INPUT";

export type PlanStepStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "SKIPPED";

export type TaskPlanStatus =
  | "DRAFT"
  | "READY"
  | "EXECUTING"
  | "VERIFYING"
  | "WAITING_FOR_USER"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED";

export interface PlanStep {
  id: string;
  type: PlanStepType;
  title: string;
  description: string;
  dependencies: string[];
  status: PlanStepStatus;
  attempts: number;
  resultSummary?: string;
}

export interface TaskPlan {
  planId: string;
  taskId: string;
  version: number;
  goal: string;
  steps: PlanStep[];
  status: TaskPlanStatus;
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// Milestone 6: Verification & Integrity Types
// ==========================================

export type VerificationStatus =
  | "PASSED"
  | "FAILED"
  | "PARTIAL"
  | "UNAVAILABLE";

export type VerificationCheckStatus =
  | "PASSED"
  | "FAILED"
  | "SKIPPED"
  | "UNAVAILABLE"
  | "CANCELLED";

export type FailureSeverity =
  | "INFO"
  | "WARNING"
  | "ERROR"
  | "CRITICAL";

export interface VerificationEvidence {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  diagnostics?: string[];
  affectedFiles?: string[];
  durationMs?: number;
}

export interface VerificationCheck {
  id: string;
  name: string;
  required: boolean;
  status: VerificationCheckStatus;
  severity?: FailureSeverity;
  validatorId?: string;
  command?: string;
  cwd?: string;
  exitCode?: number;
  startTime?: string;
  completionTime?: string;
  skipReason?: string;
  details?: string;
  evidence?: VerificationEvidence;
}

export interface VerificationResult {
  verificationId: string;
  taskId: string;
  status: VerificationStatus;
  checks: VerificationCheck[];
  summary: string;
  durationMs: number;
  timestamp: string;
}

export type WorkspaceIntegrityStatus =
  | "VERIFIED"
  | "CHANGED_EXTERNALLY"
  | "CONFLICT"
  | "UNKNOWN";

export interface WorkspaceIntegrityResult {
  status: WorkspaceIntegrityStatus;
  details?: string;
  checkedAt: string;
  conflicts?: string[];
}

// ==========================================
// Milestone 6: Failure & Diagnostic Types
// ==========================================

export type FailureType =
  | "TYPE_ERROR"
  | "TEST_FAILURE"
  | "BUILD_FAILURE"
  | "LINT_FAILURE"
  | "RUNTIME_ERROR"
  | "COMMAND_FAILURE"
  | "TIMEOUT"
  | "CONFIGURATION_ERROR"
  | "DEPENDENCY_ERROR"
  | "UNKNOWN";

export interface FailureEvidenceItem {
  type: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  raw?: string;
}

export interface FailureEvidence {
  exitCode?: number;
  stderr?: string;
  stdout?: string;
  stackTrace?: string;
  failingTests?: string[];
  items?: FailureEvidenceItem[];
}

export interface RepairAction {
  type: string;
  description: string;
  targetFiles: string[];
}

export interface FailureDiagnosis {
  diagnosisId: string;
  taskId: string;
  failureType: FailureType;
  summary: string;
  affectedFiles: string[];
  evidence: FailureEvidence;
  confidence: number;
  failureFingerprint: string;
  suggestedActions: RepairAction[];
  timestamp: string;
}

// ==========================================
// Milestone 6: Repair Types
// ==========================================

export interface RepairLimits {
  maxRepairAttempts: number;
  maxValidationRuns: number;
  maxRepairFiles: number;
  maxRepairTimeMs: number;
  maxPlanSteps?: number;
}

export interface RepairAttempt {
  attemptId: string;
  taskId: string;
  attemptNumber: number;
  failureFingerprint: string;
  repairStrategyFingerprint: string;
  repairAttemptFingerprint: string;
  targetFiles: string[];
  changeSummary: string;
  validationStatus: "PASSED" | "FAILED";
  outcome?: string;
  createdAt: string;
}

export interface RepairDecision {
  eligible: boolean;
  reason: string;
  failureFingerprint: string;
  repairStrategyFingerprint?: string;
  targetFiles: string[];
  constraints?: string[];
}

// ==========================================
// Milestone 6: Human Interaction Types
// ==========================================

export type InteractionType = "INPUT" | "APPROVAL";
export type InteractionStatus = "PENDING" | "RESOLVED" | "EXPIRED";

export type InteractionResponse =
  | { type: "APPROVE" }
  | { type: "DENY" }
  | { type: "INPUT"; value: string };

export interface InteractionRequest {
  interactionId: string;
  taskId: string;
  type: InteractionType;
  title: string;
  message: string;
  options?: string[];
  status: InteractionStatus;
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
  response?: InteractionResponse;
}

// ==========================================
// Milestone 6: Events
// ==========================================

export interface PlanCreatedEvent extends AgentEventBase {
  type: "plan.created";
  planId: string;
  planVersion: number;
  plan: TaskPlan;
}

export interface PlanUpdatedEvent extends AgentEventBase {
  type: "plan.updated";
  planId: string;
  planVersion: number;
  plan: TaskPlan;
  mutationReason?: string;
}

export interface PlanStepStartedEvent extends AgentEventBase {
  type: "plan.step.started";
  planId: string;
  planVersion: number;
  stepId: string;
}

export interface PlanStepCompletedEvent extends AgentEventBase {
  type: "plan.step.completed";
  planId: string;
  planVersion: number;
  stepId: string;
  resultSummary?: string;
}

export interface PlanStepFailedEvent extends AgentEventBase {
  type: "plan.step.failed";
  planId: string;
  planVersion: number;
  stepId: string;
  error?: string;
}

export interface PlanStepBlockedEvent extends AgentEventBase {
  type: "plan.step.blocked";
  planId: string;
  planVersion: number;
  stepId: string;
  reason?: string;
}

export interface VerificationStartedEvent extends AgentEventBase {
  type: "verification.started";
  verificationId: string;
}

export interface VerificationCompletedEvent extends AgentEventBase {
  type: "verification.completed";
  verificationId: string;
  result: VerificationResult;
}

export interface DiagnosisCreatedEvent extends AgentEventBase {
  type: "diagnosis.created";
  diagnosisId: string;
  diagnosis: FailureDiagnosis;
}

export interface RepairStartedEvent extends AgentEventBase {
  type: "repair.started";
  repairAttemptId: string;
  attemptNumber: number;
  targetFiles: string[];
}

export interface RepairCompletedEvent extends AgentEventBase {
  type: "repair.completed";
  repairAttemptId: string;
  attemptNumber: number;
  outcome: string;
}

export interface RepairFailedEvent extends AgentEventBase {
  type: "repair.failed";
  repairAttemptId: string;
  attemptNumber: number;
  reason: string;
}

export interface InteractionRequestedEvent extends AgentEventBase {
  type: "interaction.requested";
  interactionId: string;
  interaction: InteractionRequest;
}

export interface InteractionRespondedEvent extends AgentEventBase {
  type: "interaction.responded";
  interactionId: string;
  response: InteractionResponse;
}

export interface InteractionExpiredEvent extends AgentEventBase {
  type: "interaction.expired";
  interactionId: string;
}

export type AgentEvent =
  | TaskStartedEvent
  | AgentStatusEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ChangeCreatedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskCancelledEvent
  | AgentLimitReachedEvent
  | CommandStartedEvent
  | CommandCompletedEvent
  | CommandFailedEvent
  | CommandTimeoutEvent
  | CommandCancelledEvent
  // Milestone 6 additions:
  | PlanCreatedEvent
  | PlanUpdatedEvent
  | PlanStepStartedEvent
  | PlanStepCompletedEvent
  | PlanStepFailedEvent
  | PlanStepBlockedEvent
  | VerificationStartedEvent
  | VerificationCompletedEvent
  | DiagnosisCreatedEvent
  | RepairStartedEvent
  | RepairCompletedEvent
  | RepairFailedEvent
  | InteractionRequestedEvent
  | InteractionRespondedEvent
  | InteractionExpiredEvent
  // Phase 8 additions:
  | ExecutionTraceEvent
  | ModelRequestCreatedEvent
  | ModelRequestStartedEvent
  | ModelRequestSucceededEvent
  | ModelRequestFailedEvent
  | ModelRequestTimedOutEvent
  | ModelRequestCancelledEvent
  | ModelRequestRetryingEvent
  // Milestone 7 additions:
  | MemoryRecordedEvent
  | MemoryUpdatedEvent
  | MemoryRetrievedEvent
  | MemoryInvalidatedEvent
  | GitBranchCreatedEvent
  | GitStageProposedEvent
  | GitStageCompletedEvent
  | GitCommitProposedEvent
  | GitCommitCompletedEvent
  | GitPushRequestedEvent
  | GitPushCompletedEvent
  | GitPushDeniedEvent
  | SubagentStartedEvent
  | SubagentCompletedEvent
  | SubagentFailedEvent
  | SubagentCancelledEvent
  | WebDocsRequestedEvent
  | WebDocsCompletedEvent
  | WebDocsBlockedEvent;

export interface AgentLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxExecutionTimeMs: number;
  maxRepairAttempts?: number;
  maxValidationRuns?: number;
  maxRepairFiles?: number;
  maxRepairTimeMs?: number;
  maxPlanSteps?: number;
  maxSubagentsPerTask?: number;
  maxSubagentDepth?: number;
  maxTotalSubagentSteps?: number;
}

// ==========================================
// Milestone 7: Memory Models
// ==========================================

export type WorkspaceMemoryType = "CONVENTION" | "LESSON" | "EPISODE";

export type MemorySource = "USER" | "TOOL" | "VERIFICATION" | "AGENT";

export type MemoryTrustLevel =
  | "USER_VERIFIED"
  | "VERIFIED_EVIDENCE"
  | "TASK_VERIFIED"
  | "AGENT_DERIVED"
  | "UNVERIFIED";

export type MemoryStatus = "ACTIVE" | "STALE" | "INVALIDATED";

export interface WorkspaceMemoryEntry {
  id: string;
  workspaceId: string;
  type: WorkspaceMemoryType;
  content: string;
  source: MemorySource;
  trustLevel: MemoryTrustLevel;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
  invalidatedAt?: string;
  status: MemoryStatus;
  scope: {
    workspaceId: string;
    branch?: string;
    files?: string[];
  };
  evidence?: {
    taskId?: string;
    files?: string[];
    verificationIds?: string[];
    commands?: string[];
  };
  contentHash: string;
}

export interface MemoryQuery {
  workspaceId: string;
  text?: string;
  types?: WorkspaceMemoryType[];
  files?: string[];
  branch?: string;
  minTrust?: MemoryTrustLevel;
  limit?: number;
}

export interface MemoryRetrievalExplanation {
  entry: WorkspaceMemoryEntry;
  matchScore: number;
  relevanceScore: number;
  trustScore: number;
  freshnessScore: number;
  matchReason: string;
  isStale: boolean;
}

export interface MemoryQueryResult {
  entries: WorkspaceMemoryEntry[];
  explanations: MemoryRetrievalExplanation[];
}

export interface TaskEpisode {
  episodeId: string;
  taskId: string;
  workspaceId: string;
  goal: string;
  summary: string;
  changes: { path: string; operation: string }[];
  verificationStatus?: string;
  outcome: "COMPLETED" | "FAILED" | "CANCELLED";
  createdAt: string;
  evidenceReferences?: string[];
}

// ==========================================
// Milestone 7: Controlled Git Governance
// ==========================================

export interface GitBranchResult {
  success: boolean;
  branchName: string;
  created: boolean;
  previousBranch?: string;
  error?: string;
}

export interface GitStagePlan {
  taskId: string;
  authorizedFiles: string[];
}

export interface GitStageResult {
  success: boolean;
  stagedFiles: string[];
  cachedDiff: string;
  matchesChangeSet: boolean;
  error?: string;
}

export interface GitCommitPlan {
  taskId: string;
  message: string;
  authorizedChangeSetFiles: string[];
}

export interface GitCommitResult {
  success: boolean;
  commitHash?: string;
  message: string;
  branch: string;
  fileCount: number;
  error?: string;
}

export interface GitPushRequest {
  taskId: string;
  remote: string;
  branch: string;
  commitHash: string;
}

export interface GitPushResult {
  success: boolean;
  remote: string;
  branch: string;
  commitHash: string;
  error?: string;
}

// ==========================================
// Milestone 7: Supervised Worker Subagents
// ==========================================

export type SubagentType = "RESEARCH" | "VERIFICATION";

export type SubagentStatus =
  | "STARTING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "LIMIT_REACHED";

export interface SubagentBudget {
  maxSteps: number;
  maxToolCalls: number;
  maxExecutionTimeMs: number;
  maxOutputBytes?: number;
}

export interface SubagentTask {
  subagentId: string;
  parentTaskId: string;
  type: SubagentType;
  depth: 1;
  goal: string;
  budget: SubagentBudget;
  capabilities: string[];
}

export interface SubagentResult {
  subagentId: string;
  parentTaskId: string;
  type: SubagentType;
  status: SubagentStatus;
  summary: string;
  findings?: string[];
  evidence?: any;
  usage: {
    steps: number;
    toolCalls: number;
    durationMs: number;
  };
  error?: string;
}

// ==========================================
// Milestone 7: Sandboxed Web Documentation
// ==========================================

export interface WebDocRequest {
  url: string;
  maxBytes?: number;
}

export interface WebDocEvidence {
  canonicalUrl: string;
  sourceDomain: string;
  contentType: string;
  retrievedAt: string;
  contentLength: number;
}

export interface WebDocResult {
  url: string;
  canonicalUrl: string;
  sourceDomain: string;
  title: string;
  content: string;
  evidence: WebDocEvidence;
  error?: string;
}

// ==========================================
// Milestone 7: Canonical Events
// ==========================================

export interface MemoryRecordedEvent extends AgentEventBase {
  type: "memory.recorded";
  entry: WorkspaceMemoryEntry;
}

export interface MemoryUpdatedEvent extends AgentEventBase {
  type: "memory.updated";
  entry: WorkspaceMemoryEntry;
}

export interface MemoryRetrievedEvent extends AgentEventBase {
  type: "memory.retrieved";
  query: MemoryQuery;
  count: number;
  topMatches: { id: string; type: WorkspaceMemoryType; score: number }[];
}

export interface MemoryInvalidatedEvent extends AgentEventBase {
  type: "memory.invalidated";
  memoryId: string;
  reason: string;
}

export interface GitBranchCreatedEvent extends AgentEventBase {
  type: "git.branch.created";
  branchName: string;
  previousBranch?: string;
}

export interface GitStageProposedEvent extends AgentEventBase {
  type: "git.stage.proposed";
  files: string[];
}

export interface GitStageCompletedEvent extends AgentEventBase {
  type: "git.stage.completed";
  stagedFiles: string[];
  matchesChangeSet: boolean;
}

export interface GitCommitProposedEvent extends AgentEventBase {
  type: "git.commit.proposed";
  message: string;
  files: string[];
}

export interface GitCommitCompletedEvent extends AgentEventBase {
  type: "git.commit.completed";
  commitHash: string;
  message: string;
  branch: string;
  fileCount: number;
}

export interface GitPushRequestedEvent extends AgentEventBase {
  type: "git.push.requested";
  remote: string;
  branch: string;
  commitHash: string;
}

export interface GitPushCompletedEvent extends AgentEventBase {
  type: "git.push.completed";
  remote: string;
  branch: string;
  commitHash: string;
}

export interface GitPushDeniedEvent extends AgentEventBase {
  type: "git.push.denied";
  remote: string;
  branch: string;
  reason?: string;
}

export interface SubagentStartedEvent extends AgentEventBase {
  type: "subagent.started";
  subagentId: string;
  subagentType: SubagentType;
  goal: string;
}

export interface SubagentCompletedEvent extends AgentEventBase {
  type: "subagent.completed";
  subagentId: string;
  subagentType: SubagentType;
  result: SubagentResult;
}

export interface SubagentFailedEvent extends AgentEventBase {
  type: "subagent.failed";
  subagentId: string;
  subagentType: SubagentType;
  error: string;
}

export interface SubagentCancelledEvent extends AgentEventBase {
  type: "subagent.cancelled";
  subagentId: string;
  subagentType: SubagentType;
}

export interface WebDocsRequestedEvent extends AgentEventBase {
  type: "webdocs.requested";
  url: string;
}

export interface WebDocsCompletedEvent extends AgentEventBase {
  type: "webdocs.completed";
  url: string;
  canonicalUrl: string;
  title: string;
  contentLength: number;
}

export interface WebDocsBlockedEvent extends AgentEventBase {
  type: "webdocs.blocked";
  url: string;
  reason: string;
}

// ============================================================================
// PROVIDER & API KEY CONFIGURATION (BYOK)
// ============================================================================

export type ProviderStatus =
  | "NOT_CONFIGURED"
  | "CONNECTING"
  | "CONNECTED"
  | "INVALID_CREDENTIAL"
  | "CONNECTION_ERROR"
  | "TIMEOUT"
  | "DISABLED";

export interface ProviderModel {
  id: string;
  name: string;
  description?: string;
  contextTokens?: number;
}

export interface ProviderConfig {
  providerId: string;
  displayName: string;
  enabled: boolean;
  endpoint?: string;
  selectedModel?: string;
  hasCredential: boolean;
  isLocal?: boolean;
  status: ProviderStatus;
  models: ProviderModel[];
  environmentDetected?: boolean;
  description?: string;
}

export interface ProviderTestResult {
  provider: string;
  status: ProviderStatus;
  model?: string;
  latencyMs?: number;
  message?: string;
}

