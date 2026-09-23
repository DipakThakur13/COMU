import { AgentEvent, TaskAutonomy } from "@comu/protocol";
import { appendActivity, groupActivity } from "./group.js";
import { categorizeToolName, describeFailure, eventKey, humanAgentState, liveToolLabel, normalizeEvent } from "./normalize.js";
import {
  ActivityEntry,
  ActivityItem,
  ChangeView,
  MAX_ACTIVITY_ENTRIES,
  MAX_INSPECTED_FILES,
  MAX_SEEN_EVENT_IDS,
  MAX_STREAM_CHARS,
  PlanView,
  SequencedEvent,
  SessionState,
  StreamingView,
  WorkerView,
  WorkingSetView,
  isActivityGroup
} from "./types.js";

export function createInitialSessionState(autonomy: TaskAutonomy = "ask"): SessionState {
  return {
    connection: "connecting",
    status: "idle",
    agentState: "IDLE",
    autonomy,
    activity: [],
    elidedCount: 0,
    changes: [],
    workingSet: { inspectedFiles: [], modifiedFiles: [] },
    approvals: [],
    repairs: [],
    workers: [],
    memory: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0, costKnown: true },
    timing: { waitingMs: 0 },
    seenEventIds: [],
    replication: { lastSeq: -1, needsResync: false }
  };
}

/** Starts a fresh task, keeping only connection and composer-level preferences. */
export function startTask(
  state: SessionState,
  input: { taskId: string; prompt: string; modelId?: string; autonomy: TaskAutonomy; mode?: string }
): SessionState {
  const next = createInitialSessionState(input.autonomy);
  next.connection = state.connection;
  next.taskId = input.taskId;
  next.prompt = input.prompt;
  next.modelId = input.modelId;
  next.status = "running";
  next.agentState = "STARTING";
  next.timing = { startedAt: Date.now(), waitingMs: 0 };
  next.live = { label: "Starting", startedAt: new Date().toISOString() };
  if (input.mode && input.mode !== "AUTO") {
    next.mode = input.mode as SessionState["mode"];
    next.modeSource = "explicit";
  }
  return next;
}

/**
 * Applies a sequenced event to the replica.
 *
 * The extension host is authoritative and assigns a monotonic sequence per task. A gap means at
 * least one event was dropped, so applying this one would silently corrupt the replica: the event
 * is refused and `replication.needsResync` is raised for the consumer to request a snapshot.
 * Duplicates (a replay overlapping live delivery) are ignored without raising a resync.
 */
export function applySequenced(state: SessionState, sequenced: SequencedEvent): SessionState {
  const { seq, event } = sequenced;
  const expected = state.replication.lastSeq + 1;

  if (seq <= state.replication.lastSeq) {
    return state; // already applied
  }
  if (state.replication.lastSeq >= 0 && seq !== expected) {
    return {
      ...state,
      replication: { ...state.replication, needsResync: true, gapAt: seq }
    };
  }
  if (state.replication.needsResync) {
    return state; // refuse everything until a snapshot arrives
  }

  const next = reduceEvent(state, event);
  return { ...next, replication: { ...next.replication, lastSeq: seq } };
}

/** Rebuilds the replica from an authoritative snapshot and clears any resync request. */
export function applySnapshot(snapshot: SessionState, seq: number): SessionState {
  return { ...snapshot, replication: { lastSeq: seq, needsResync: false } };
}

/**
 * The single event-to-state reduction, shared by the extension host and the webview replica.
 * Pure: no clock beyond event timestamps, no DOM, no I/O.
 */
export function reduceEvent(state: SessionState, event: AgentEvent): SessionState {
  if (!event || typeof event.type !== "string") return state;

  // Token deltas are high frequency and carry no timeline entry of their own.
  if (event.type === "model.token_delta") {
    return reduceTokenDelta(state, event as any);
  }

  const key = eventKey(event);
  if (state.seenEventIds.includes(key)) return state;

  let next: SessionState = { ...state, seenEventIds: rememberEvent(state.seenEventIds, key) };
  const e = event as any;

  // A replica rebuilt purely from the stream still knows which task it is watching.
  if (!next.taskId && typeof e.taskId === "string" && e.taskId) {
    next.taskId = e.taskId;
  }

  switch (event.type) {
    case "task.started":
      next.status = "running";
      next.agentState = "STARTING";
      next.timing = { ...next.timing, startedAt: next.timing.startedAt ?? (Date.parse(e.timestamp) || undefined) };
      next.live = { label: "Starting", startedAt: e.timestamp };
      break;

    case "task.mode_resolved":
      next.mode = e.mode;
      next.modeSource = e.source;
      break;

    /*
     * A status is what is happening now, so it lands in the live line and nowhere else.
     *
     * The state is read from the event's own `state` field rather than inferred from the wording
     * of its message, which is how "Executing tools..." ended up being both the header's idea of
     * the state and a permanent row of history. The message is still honoured for a runtime that
     * predates the field.
     */
    case "agent.status": {
      const raw = String(e.status || "");
      const upper = raw.toUpperCase();
      const declared = typeof e.state === "string" ? e.state.toUpperCase() : undefined;
      const state = declared && KNOWN_AGENT_STATES.has(declared) ? declared : KNOWN_AGENT_STATES.has(upper) ? upper : undefined;

      if (state) next.agentState = state as SessionState["agentState"];
      if (state === "WAITING_FOR_USER" || upper.startsWith("WAITING")) {
        next.status = "waiting_for_user";
      } else if (state === "COMPLETED" || upper === "COMPLETED") {
        next.agentState = "COMPLETED";
      } else if (state === "FAILED" || upper === "FAILED") {
        next.agentState = "FAILED";
      } else if (next.status === "waiting_for_user" && state !== "CANCELLED" && upper !== "CANCELLED") {
        next.status = "running";
      }

      next.live = TERMINAL_AGENT_STATES.has(next.agentState)
        ? undefined
        : { label: humanAgentState(state) ?? cleanStatusMessage(raw), startedAt: e.timestamp };
      break;
    }

    case "tool.started":
      next.live = { label: liveToolLabel(String(e.tool || ""), e.target), startedAt: e.timestamp };
      break;

    case "change.created":
      next.changes = upsertChange(next.changes, {
        path: e.path,
        operation: e.operation,
        additions: e.additions,
        deletions: e.deletions
      });
      next.workingSet = noteModified(next.workingSet, e.path);
      break;

    case "plan.created":
    case "plan.updated":
      next.plan = toPlanView(e.plan, e.planVersion);
      break;

    case "plan.step.started":
    case "plan.step.completed":
    case "plan.step.failed":
    case "plan.step.blocked":
      next.plan = applyStepStatus(next.plan, e);
      break;

    case "verification.completed":
      next.verification = e.result;
      break;

    case "diagnosis.created":
      next.diagnosis = e.diagnosis;
      break;

    case "repair.started":
      next.repairs = [...next.repairs, { attemptId: e.repairAttemptId, attemptNumber: e.attemptNumber, targetFiles: e.targetFiles || [] } as any];
      break;

    case "repair.completed":
    case "repair.failed":
      next.repairs = next.repairs.map(r =>
        (r as any).attemptId === e.repairAttemptId ? ({ ...r, outcome: e.outcome || e.reason } as any) : r
      );
      break;

    case "subagent.started":
      next.workers = upsertWorker(next.workers, {
        subagentId: e.subagentId,
        subagentType: e.subagentType,
        goal: e.goal,
        status: "RUNNING"
      });
      break;

    case "subagent.completed":
      next.workers = upsertWorker(next.workers, {
        subagentId: e.subagentId,
        subagentType: e.subagentType,
        status: "COMPLETED",
        summary: e.result?.summary
      });
      break;

    case "subagent.failed":
      next.workers = upsertWorker(next.workers, {
        subagentId: e.subagentId,
        subagentType: e.subagentType,
        status: "FAILED",
        summary: e.error
      });
      break;

    case "subagent.cancelled":
      next.workers = upsertWorker(next.workers, {
        subagentId: e.subagentId,
        subagentType: e.subagentType,
        status: "CANCELLED"
      });
      break;

    case "interaction.requested": {
      const interaction = e.interaction;
      next.pendingInteraction = interaction;
      next.status = "waiting_for_user";
      // The card is the live state while it is on screen, full width and with its own countdown.
      // A status line underneath it saying the same thing is the repetition this panel is short of
      // room for. The next transition after the decision sets the line again.
      next.live = undefined;
      if (interaction?.type === "APPROVAL") {
        next.pendingApproval = {
          interactionId: interaction.interactionId,
          taskId: interaction.taskId,
          title: interaction.title,
          message: interaction.message,
          payload: interaction.approval,
          createdAt: interaction.createdAt,
          expiresAt: interaction.expiresAt
        };
      }
      break;
    }

    case "interaction.responded":
    case "interaction.expired":
      next.pendingApproval = undefined;
      next.pendingInteraction = undefined;
      if (next.status === "waiting_for_user") next.status = "running";
      break;

    case "approval.decided":
      next.approvals = [...next.approvals, e];
      next.pendingApproval = undefined;
      break;

    case "memory.recorded":
      next.memory = e.entry ? [...next.memory, e.entry] : next.memory;
      break;

    case "model_request.succeeded": {
      next.usage = accumulateUsage(next.usage, e.usage, e.costUsd);
      // One call: folding mutates both fields, and calling twice would discard the folded item.
      const folded = foldStreamingRequest(next, e.requestId);
      next.streaming = folded.streaming;
      next.activity = folded.activity;
      break;
    }

    case "task.completed":
      next.status = "completed";
      next.agentState = "COMPLETED";
      next.finalText = e.finalText ?? next.finalText;
      next.timing = { ...next.timing, endedAt: Date.parse(e.timestamp) || Date.now() };
      next.pendingApproval = undefined;
      next.pendingInteraction = undefined;
      next.live = undefined;
      // The answer is printed once. A reply that streamed into the stream grows into its final
      // text in place; one that never streamed gets the row it never had.
      next = foldFinalText(next, e.finalText, e.timestamp);
      break;

    case "task.failed":
      next.status = "failed";
      next.agentState = "FAILED";
      next.error = {
        code: e.payload?.code || (next.limit ? "LIMIT_REACHED" : "TASK_FAILED"),
        message: e.payload?.message || e.error || "Task failed",
        hint: next.limit ? "Raise the limit or split the task." : undefined
      };
      next.timing = { ...next.timing, endedAt: Date.parse(e.timestamp) || Date.now() };
      next.pendingApproval = undefined;
      next.pendingInteraction = undefined;
      next.live = undefined;
      break;

    case "task.cancelled":
      next.status = "cancelled";
      next.agentState = "CANCELLED";
      next.timing = { ...next.timing, endedAt: Date.parse(e.timestamp) || Date.now() };
      next.pendingApproval = undefined;
      next.pendingInteraction = undefined;
      next.live = undefined;
      break;

    /*
     * A limit is not an event a person needs in their history; it is the reason the failure that
     * follows will give. Recording it here is what lets one row say "Failed · time limit reached"
     * instead of two rows saying "Max execution time reached" and "Task failed: LIMIT_REACHED".
     */
    case "agent.limit_reached":
      next.limit = e.limit;
      next.error = {
        code: "LIMIT_REACHED",
        message: describeFailure({ code: "LIMIT_REACHED", message: "" }, e.limit) ?? `Limit reached: ${e.limit}`,
        hint: "Raise the limit or split the task."
      };
      break;

    default:
      break;
  }

  const inspected = inspectedPath(event);
  if (inspected) {
    next.workingSet = noteInspected(next.workingSet, inspected);
  }

  // The second pass: what the agent did, rather than which state the loop was in when it did it.
  // The mode and the limit are the context that decides whether an event earns a row at all.
  const item = normalizeEvent(event, { mode: next.mode, limit: next.limit });
  if (item) {
    next = withActivity(next, item);
  }
  return next;
}

/**
 * The file a tool event touched, if any.
 *
 * Tool events carry their target in whichever field the tool happened to use, so this checks the
 * same places the panel's own rendering does rather than assuming one shape.
 */
function inspectedPath(event: AgentEvent): string | undefined {
  if (event.type !== "tool.started" && event.type !== "tool.completed") return undefined;
  const e = event as any;
  // `target` is whatever the call was about, which for a search is a query and for a command is a
  // command line. Only the tools whose subject is a file may contribute one.
  const targetIsPath = FILE_TOOL_CATEGORIES.has(categorizeToolName(String(e.tool || "")));
  const candidate = e.path ?? e.filePath ?? e.result?.path ?? e.result?.filePath ?? (targetIsPath ? e.target : undefined);
  return typeof candidate === "string" && candidate ? candidate : undefined;
}

const FILE_TOOL_CATEGORIES = new Set(["Read", "Edit", "Write", "Create"]);

/** Newest first, de-duplicated, bounded. */
function noteInspected(set: WorkingSetView, path: string): WorkingSetView {
  if (set.inspectedFiles[0] === path) return set;
  const rest = set.inspectedFiles.filter(p => p !== path);
  return { ...set, inspectedFiles: [path, ...rest].slice(0, MAX_INSPECTED_FILES) };
}

/** Files COMU has written. Unbounded on purpose: every one of them is a change the user must see. */
function noteModified(set: WorkingSetView, path: string): WorkingSetView {
  if (!path || set.modifiedFiles.includes(path)) return set;
  return { ...set, modifiedFiles: [...set.modifiedFiles, path] };
}

// ---------------------------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------------------------

function reduceTokenDelta(state: SessionState, e: any): SessionState {
  // Worker turns are a separate channel and must never enter the assistant's stream.
  if (e.channel === "subagent") {
    if (!e.subagentId || e.kind !== "text") return state;
    return {
      ...state,
      workers: state.workers.map(w =>
        w.subagentId === e.subagentId ? { ...w, streamText: clampStream((w.streamText || "") + e.delta) } : w
      )
    };
  }

  const current = state.streaming;
  if (!current || current.requestId !== e.requestId) {
    // A new request replaces the buffer; anything unfolded from the previous one is already in
    // the activity stream by way of model_request.succeeded.
    const consumedTo = typeof e.endIndex === "number" && e.endIndex >= e.index ? e.endIndex : e.index;
    const fresh: StreamingView = {
      requestId: e.requestId,
      text: e.kind === "text" ? e.delta : "",
      reasoning: e.kind === "reasoning" ? e.delta : "",
      lastIndex: { text: e.kind === "text" ? consumedTo : -1, reasoning: e.kind === "reasoning" ? consumedTo : -1 },
      startedAt: e.timestamp
    };
    return { ...state, streaming: fresh };
  }

  const kind: "text" | "reasoning" = e.kind === "reasoning" ? "reasoning" : "text";
  const expected = current.lastIndex[kind] + 1;
  if (e.index < expected) return state; // duplicate
  const gap = e.index > expected;
  // A coalesced message covers index..endIndex; resume from the end of the range.
  const consumedTo = typeof e.endIndex === "number" && e.endIndex >= e.index ? e.endIndex : e.index;

  return {
    ...state,
    streaming: {
      ...current,
      [kind]: clampStream(current[kind] + e.delta),
      lastIndex: { ...current.lastIndex, [kind]: consumedTo }
    },
    // A dropped delta means the live text is no longer faithful; ask for a snapshot rather than
    // showing text with a hole in it. The final text still arrives on task.completed.
    replication: gap ? { ...state.replication, needsResync: true, gapAt: e.index } : state.replication
  };
}

function clampStream(text: string): string {
  return text.length <= MAX_STREAM_CHARS ? text : text.slice(text.length - MAX_STREAM_CHARS);
}

/** Turns a finished streaming buffer into one activity item. */
function foldStreamingRequest(state: SessionState, requestId: string): { streaming?: StreamingView; activity: ActivityEntry[] } {
  const current = state.streaming;
  if (!current || current.requestId !== requestId || !current.text.trim()) {
    return { streaming: current && current.requestId === requestId ? undefined : current, activity: state.activity };
  }
  const item = messageItem(`msg-${requestId}`, current.text.trim(), current.startedAt, current.reasoning || undefined);
  return { streaming: undefined, activity: capActivity(appendActivity(state.activity, item)).entries };
}

function messageItem(id: string, text: string, timestamp: string, reasoning?: string): ActivityItem {
  return {
    id,
    category: "AGENT_MESSAGE",
    level: "substance",
    status: "completed",
    title: "Assistant",
    shortDescription: text,
    timestamp,
    details: { text, reasoning }
  };
}

/**
 * Makes the reply that is already in the stream the final one, rather than printing it again.
 *
 * `task.completed` carries the whole answer, and the last assistant row usually holds the same
 * answer as it streamed in. Replacing that row's text in place is the difference between a reply
 * that grows into its final form and a reply that appears twice, once truncated in the stream and
 * once in full in a panel below it.
 */
function foldFinalText(state: SessionState, finalText: string | undefined, timestamp: string): SessionState {
  const text = (finalText || "").trim();
  if (!text) return state;

  for (let index = state.activity.length - 1; index >= 0; index--) {
    const entry = state.activity[index];
    if (isActivityGroup(entry) || entry.category !== "AGENT_MESSAGE") continue;
    const streamed = (entry.shortDescription || "").trim();
    // The same answer, or the beginning of it: the row is the reply, so it becomes the whole reply.
    if (!text.startsWith(streamed) && !streamed.startsWith(text)) break;
    const merged = messageItem(entry.id, text, entry.timestamp, (entry.details as any)?.reasoning);
    return { ...state, activity: state.activity.map((e, i) => (i === index ? merged : e)) };
  }

  const { entries } = capActivity(appendActivity(state.activity, messageItem(`msg-final`, text, timestamp)));
  return { ...state, activity: entries };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const KNOWN_AGENT_STATES = new Set([
  "IDLE", "STARTING", "CLASSIFYING", "ANALYZING", "PLANNING", "THINKING", "TOOL_CALLING",
  "OBSERVING", "VERIFYING", "DIAGNOSING", "REPAIRING", "WAITING_FOR_USER", "COMPLETED",
  "FAILED", "CANCELLED", "LIMIT_REACHED"
]);

/** Once the task is in one of these there is no "now" left to report, so the live line goes away. */
const TERMINAL_AGENT_STATES = new Set(["COMPLETED", "FAILED", "CANCELLED", "LIMIT_REACHED"]);

/** A runtime message written for a log, trimmed to something a status line can say. */
function cleanStatusMessage(message: string): string {
  const trimmed = message.replace(/\.{3}$/, "").trim();
  return trimmed || "Working";
}

function withActivity(state: SessionState, item: ActivityItem): SessionState {
  const { entries, elided } = capActivity(appendActivity(state.activity, item));
  return { ...state, activity: entries, elidedCount: state.elidedCount + elided };
}

/**
 * Keeps the timeline within the runtime's own 5000-event ceiling. Dropping happens from the front
 * and is counted, so the interface can offer an explicit "earlier activity elided" affordance
 * instead of silently losing history.
 */
export function capActivity(entries: ActivityEntry[]): { entries: ActivityEntry[]; elided: number } {
  if (entries.length <= MAX_ACTIVITY_ENTRIES) return { entries, elided: 0 };
  const overflow = entries.length - MAX_ACTIVITY_ENTRIES;
  const dropped = entries.slice(0, overflow);
  const elided = dropped.reduce((n, entry) => n + (isActivityGroup(entry) ? entry.items.length : 1), 0);
  return { entries: entries.slice(overflow), elided };
}

/** Bounded dedupe window; an array so the snapshot survives postMessage. */
export function rememberEvent(seen: string[], key: string): string[] {
  const next = seen.length >= MAX_SEEN_EVENT_IDS ? seen.slice(seen.length - MAX_SEEN_EVENT_IDS + 1) : seen.slice();
  next.push(key);
  return next;
}

function upsertChange(changes: ChangeView[], change: ChangeView): ChangeView[] {
  const index = changes.findIndex(c => c.path === change.path);
  if (index === -1) return [...changes, change];
  const merged = { ...changes[index], ...change, operation: changes[index].operation };
  return changes.map((c, i) => (i === index ? merged : c));
}

function upsertWorker(workers: WorkerView[], worker: Partial<WorkerView> & { subagentId: string }): WorkerView[] {
  const index = workers.findIndex(w => w.subagentId === worker.subagentId);
  if (index === -1) {
    return [...workers, { subagentType: "RESEARCH", status: "RUNNING", ...worker } as WorkerView];
  }
  return workers.map((w, i) => (i === index ? { ...w, ...worker } : w));
}

function accumulateUsage(usage: SessionState["usage"], reported: any, costUsd?: number): SessionState["usage"] {
  if (!reported) {
    return { ...usage, requests: usage.requests + 1, costKnown: usage.costKnown && costUsd !== undefined };
  }
  const costKnown = usage.costKnown && costUsd !== undefined;
  return {
    promptTokens: usage.promptTokens + (reported.promptTokens || 0),
    completionTokens: usage.completionTokens + (reported.completionTokens || 0),
    totalTokens: usage.totalTokens + (reported.totalTokens || 0),
    requests: usage.requests + 1,
    costUsd: costKnown ? (usage.costUsd || 0) + (costUsd || 0) : undefined,
    costKnown
  };
}

export function toPlanView(plan: any, version?: number): PlanView | undefined {
  if (!plan || !Array.isArray(plan.steps)) return undefined;
  const steps = plan.steps.map((s: any) => ({
    id: s.id,
    type: s.type,
    title: s.title,
    description: s.description,
    status: s.status,
    resultSummary: s.resultSummary
  }));
  return {
    planId: plan.planId,
    version: version ?? plan.version ?? 1,
    goal: plan.goal,
    steps,
    currentIndex: computeCurrentIndex(steps),
    completedCount: steps.filter((s: any) => s.status === "COMPLETED").length
  };
}

function applyStepStatus(plan: PlanView | undefined, e: any): PlanView | undefined {
  if (!plan) return plan;
  const status =
    e.type === "plan.step.started" ? "RUNNING" :
    e.type === "plan.step.completed" ? "COMPLETED" :
    e.type === "plan.step.failed" ? "FAILED" : "BLOCKED";
  const steps = plan.steps.map(s =>
    s.id === e.stepId ? { ...s, status: status as PlanStepStatus, resultSummary: e.resultSummary ?? s.resultSummary } : s
  );
  return { ...plan, steps, currentIndex: computeCurrentIndex(steps), completedCount: steps.filter(s => s.status === "COMPLETED").length };
}

type PlanStepStatus = PlanView["steps"][number]["status"];

function computeCurrentIndex(steps: Array<{ status: string }>): number {
  const running = steps.findIndex(s => s.status === "RUNNING");
  if (running !== -1) return running;
  const pending = steps.findIndex(s => s.status === "PENDING");
  return pending;
}

/** Rebuilds grouped activity from raw items. Exposed for snapshot construction and tests. */
export { groupActivity };
