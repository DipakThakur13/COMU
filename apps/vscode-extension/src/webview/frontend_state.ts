// @ts-check
/**
 * COMU AI — Frontend State Model & Event Normalization Layer (Phase 9)
 *
 * Implements the centralized ComuViewState, pure event normalizer,
 * activity item grouping, and state reducer.
 * Pure presentation logic: no backend authority, no fake state, no secrets.
 */

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

export type ActivityCategory =
  | "AGENT_MESSAGE"
  | "TOOL_ACTIVITY"
  | "COMMAND_OUTPUT"
  | "VALIDATION"
  | "DIAGNOSIS"
  | "REPAIR"
  | "SYSTEM_EVENT";

export type ToolCategory =
  | "Read"
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

export interface UIActivityItem {
  id: string;
  category: ActivityCategory;
  toolCategory?: ToolCategory;
  status: ActivityStatus;
  title: string;
  shortDescription?: string;
  timestamp: string;
  durationMs?: number;
  details?: Record<string, any>;
  rawEvent?: any;
}

export interface UIActivityGroup {
  id: string;
  isGroup: true;
  category: ActivityCategory;
  toolCategory: ToolCategory;
  status: ActivityStatus;
  title: string;
  shortDescription?: string;
  items: UIActivityItem[];
  timestamp: string;
}

export type ActivityEntry = UIActivityItem | UIActivityGroup;

export interface ComuViewState {
  taskId?: string | null;
  prompt?: string | null;
  interactionMode: InteractionMode;
  agentState: AgentState;
  status: "idle" | "running" | "cancelling" | "waiting_for_user" | "completed" | "failed" | "cancelled" | "offline";
  selectedModelId: string;
  requestedMode: "AUTO" | InteractionMode;
  activeNavTab: "overview" | "plan" | "activity" | "changes" | "verification" | "memory" | "workers";
  activity: ActivityEntry[];
  changes: Array<{ path: string; operation: "CREATE" | "MODIFY" }>;
  plan?: any | null;
  verification?: any | null;
  diagnosis?: any | null;
  repairAttempts: any[];
  workingSet?: {
    activeFile?: string;
    openFiles?: string[];
    recentlyInspectedFiles?: string[];
    searchResults?: any[];
    diagnostics?: any[];
    modifiedFiles?: any[];
  };
  memory: any[];
  workers: any[];
  providers: any[];
  pendingInteraction?: any | null;
  gitCommitProposal?: any | null;
  gitPushProposal?: any | null;
  finalResponse?: string | null;
  startTime?: number;
  completedTime?: number;
  durationMs?: number;
  estimatedTokens?: number;
  cancellation: {
    requested: boolean;
    acknowledged: boolean;
    error?: string;
  };
  contextDrawerOpen: boolean;
}

export function createInitialViewState(): ComuViewState {
  return {
    taskId: null,
    prompt: null,
    interactionMode: "CHAT",
    agentState: "IDLE",
    status: "idle",
    selectedModelId: "",
    requestedMode: "AUTO",
    activeNavTab: "activity",
    activity: [],
    changes: [],
    plan: null,
    verification: null,
    diagnosis: null,
    repairAttempts: [],
    workingSet: {
      openFiles: [],
      recentlyInspectedFiles: [],
      searchResults: [],
      diagnostics: [],
      modifiedFiles: []
    },
    memory: [],
    workers: [],
    providers: [],
    pendingInteraction: null,
    gitCommitProposal: null,
    gitPushProposal: null,
    finalResponse: null,
    cancellation: {
      requested: false,
      acknowledged: false
    },
    contextDrawerOpen: false
  };
}

/**
 * Normalizes raw backend AgentEvent into a clean, typed UIActivityItem.
 */
export function normalizeAgentEvent(event: any): UIActivityItem | null {
  if (!event || !event.type) return null;

  const id = `${event.taskId || 'task'}-${event.eventId || Date.now()}-${event.type}`;
  const timestamp = event.timestamp || new Date().toISOString();

  switch (event.type) {
    case "task.started":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "completed",
        title: "Task started",
        shortDescription: "Initialized execution context",
        timestamp
      };

    case "agent.status": {
      const st = (event.status || "").toUpperCase();
      let status: ActivityStatus = "active";
      if (st === "COMPLETED") status = "completed";
      else if (st === "FAILED" || st.includes("ERROR")) status = "failed";
      else if (st === "CANCELLED") status = "warning";

      let toolCat: ToolCategory = "Generic";
      if (st.includes("READ")) toolCat = "Read";
      else if (st.includes("SEARCH")) toolCat = "Search";
      else if (st.includes("EDIT")) toolCat = "Edit";
      else if (st.includes("VERIF")) toolCat = "Verification";
      else if (st.includes("DIAG")) toolCat = "Diagnosis";
      else if (st.includes("REPAIR")) toolCat = "Repair";

      return {
        id,
        category: "SYSTEM_EVENT",
        toolCategory: toolCat,
        status,
        title: event.status || "Agent status update",
        timestamp
      };
    }

    case "tool.started": {
      const toolName = event.tool || "tool";
      const toolCat = categorizeToolName(toolName);
      const target = event.path || event.filePath || event.command || event.pattern || "";
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: toolCat,
        status: "active",
        title: `${toolCat} started: ${formatTarget(toolCat, target, toolName)}`,
        shortDescription: target || toolName,
        timestamp,
        details: { tool: toolName, ...event }
      };
    }

    case "tool.completed": {
      const toolName = event.tool || "tool";
      const toolCat = categorizeToolName(toolName);
      const target = event.path || event.filePath || (event.result && (event.result.path || event.result.target)) || "";
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: toolCat,
        status: "completed",
        title: `${toolCat} completed: ${formatTarget(toolCat, target, toolName)}`,
        shortDescription: target || (event.result && event.result.summary) || "Completed",
        timestamp,
        details: { tool: toolName, result: event.result }
      };
    }

    case "change.created":
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: event.operation === "CREATE" ? "Create" : "Edit",
        status: "completed",
        title: `${event.operation === "CREATE" ? "Created" : "Modified"} ${event.path}`,
        shortDescription: event.path,
        timestamp,
        details: { path: event.path, operation: event.operation }
      };

    case "plan.created":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "completed",
        title: `Plan generated (v${event.planVersion || 1})`,
        shortDescription: `${event.plan?.steps?.length || 0} steps`,
        timestamp,
        details: { plan: event.plan }
      };

    case "plan.step.started":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "active",
        title: `Step started: ${event.stepId}`,
        timestamp
      };

    case "plan.step.completed":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "completed",
        title: `Step completed: ${event.stepId}`,
        shortDescription: event.resultSummary,
        timestamp
      };

    case "plan.step.failed":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "failed",
        title: `Step failed: ${event.stepId}`,
        shortDescription: event.error,
        timestamp
      };

    case "verification.started":
      return {
        id,
        category: "VALIDATION",
        toolCategory: "Verification",
        status: "active",
        title: "Verification started",
        timestamp
      };

    case "verification.completed": {
      const isPassed = event.result?.status === "PASSED";
      return {
        id,
        category: "VALIDATION",
        toolCategory: "Verification",
        status: isPassed ? "completed" : "failed",
        title: `Verification ${event.result?.status || "completed"}`,
        shortDescription: event.result?.summary || "",
        timestamp,
        durationMs: event.result?.durationMs,
        details: { result: event.result }
      };
    }

    case "diagnosis.created":
      return {
        id,
        category: "DIAGNOSIS",
        toolCategory: "Diagnosis",
        status: "warning",
        title: `Diagnosis: ${event.diagnosis?.failureType || "Issue identified"}`,
        shortDescription: event.diagnosis?.summary || "",
        timestamp,
        details: { diagnosis: event.diagnosis }
      };

    case "repair.started":
      return {
        id,
        category: "REPAIR",
        toolCategory: "Repair",
        status: "active",
        title: `Repair attempt ${event.attemptNumber} started`,
        timestamp,
        details: { targetFiles: event.targetFiles }
      };

    case "repair.completed":
      return {
        id,
        category: "REPAIR",
        toolCategory: "Repair",
        status: "completed",
        title: `Repair attempt ${event.attemptNumber} completed`,
        shortDescription: event.outcome,
        timestamp
      };

    case "subagent.started":
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: "Worker",
        status: "active",
        title: `${event.subagentType || "Subagent"} worker started`,
        shortDescription: event.goal,
        timestamp
      };

    case "subagent.completed":
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: "Worker",
        status: "completed",
        title: `${event.subagentType || "Subagent"} worker completed`,
        shortDescription: event.result?.summary,
        timestamp
      };

    case "subagent.failed":
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: "Worker",
        status: "failed",
        title: `${event.subagentType || "Subagent"} worker failed`,
        shortDescription: event.error,
        timestamp
      };

    case "command.started":
      return {
        id,
        category: "COMMAND_OUTPUT",
        toolCategory: "Terminal",
        status: "active",
        title: "Terminal command started",
        timestamp
      };

    case "command.completed":
      return {
        id,
        category: "COMMAND_OUTPUT",
        toolCategory: "Terminal",
        status: "completed",
        title: "Terminal command finished",
        timestamp
      };

    case "command.failed":
      return {
        id,
        category: "COMMAND_OUTPUT",
        toolCategory: "Terminal",
        status: "failed",
        title: "Terminal command failed",
        timestamp
      };

    case "task.completed":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "completed",
        title: "Task completed successfully",
        timestamp
      };

    case "task.failed":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "failed",
        title: `Task failed: ${event.error || "Unknown failure"}`,
        timestamp
      };

    case "task.cancelled":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "warning",
        title: "Task cancelled by user",
        timestamp
      };

    default:
      return null;
  }
}

function categorizeToolName(name: string): ToolCategory {
  const lower = name.toLowerCase();
  if (lower.includes("read")) return "Read";
  if (lower.includes("search") || lower.includes("find") || lower.includes("grep")) return "Search";
  if (lower.includes("edit") || lower.includes("replace") || lower.includes("patch")) return "Edit";
  if (lower.includes("write")) return "Write";
  if (lower.includes("create")) return "Create";
  if (lower.includes("terminal") || lower.includes("exec") || lower.includes("bash") || lower.includes("cmd")) return "Terminal";
  if (lower.includes("git")) return "Git";
  if (lower.includes("verif") || lower.includes("test") || lower.includes("lint")) return "Verification";
  if (lower.includes("diag")) return "Diagnosis";
  if (lower.includes("repair")) return "Repair";
  if (lower.includes("worker") || lower.includes("subagent")) return "Worker";
  return "Generic";
}

function formatTarget(cat: ToolCategory, target: string, fallback: string): string {
  if (!target) return fallback;
  const parts = target.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : target;
}

/**
 * Group repetitive activity items (e.g. 4 consecutive file reads into "Read 4 files").
 */
export function groupActivityItems(items: UIActivityItem[]): ActivityEntry[] {
  if (!items || items.length === 0) return [];

  const grouped: ActivityEntry[] = [];
  let currentGroup: UIActivityItem[] = [];
  let currentCategory: ToolCategory | undefined = undefined;

  function flushGroup() {
    if (currentGroup.length === 0) return;
    if (currentGroup.length === 1) {
      grouped.push(currentGroup[0]);
    } else {
      const first = currentGroup[0];
      const cat = currentCategory || "Generic";
      let title = "";
      if (cat === "Read") {
        title = `Read ${currentGroup.length} files`;
      } else if (cat === "Search") {
        title = `Searched repository (${currentGroup.length} queries)`;
      } else {
        title = `${cat} operations (${currentGroup.length})`;
      }

      grouped.push({
        id: `group-${first.id}-${currentGroup.length}`,
        isGroup: true,
        category: first.category,
        toolCategory: cat,
        status: currentGroup.some(i => i.status === "failed") ? "failed" :
                currentGroup.some(i => i.status === "active") ? "active" : "completed",
        title,
        shortDescription: `${currentGroup.length} ${cat.toLowerCase()} activities`,
        items: [...currentGroup],
        timestamp: currentGroup[currentGroup.length - 1].timestamp
      });
    }
    currentGroup = [];
    currentCategory = undefined;
  }

  for (const item of items) {
    const isGroupable = item.category === "TOOL_ACTIVITY" && (item.toolCategory === "Read" || item.toolCategory === "Search");

    if (isGroupable) {
      if (currentCategory === item.toolCategory) {
        currentGroup.push(item);
      } else {
        flushGroup();
        currentCategory = item.toolCategory;
        currentGroup.push(item);
      }
    } else {
      flushGroup();
      grouped.push(item);
    }
  }

  flushGroup();
  return grouped;
}

/**
 * Bounds visible activity items to the latest N items for rendering performance.
 */
export function boundActivityHistory(items: ActivityEntry[], maxItems: number = 50): { visible: ActivityEntry[]; olderCount: number } {
  if (!items || items.length <= maxItems) {
    return { visible: items || [], olderCount: 0 };
  }
  return {
    visible: items.slice(-maxItems),
    olderCount: items.length - maxItems
  };
}

/**
 * Pure state reducer for the view state.
 */
export function reduceViewState(state: ComuViewState, action: { type: string; payload?: any }): ComuViewState {
  switch (action.type) {
    case "SET_SESSION_STATE": {
      const s = action.payload || {};
      const newItems: UIActivityItem[] = [];
      const seenIds = new Set<string>();

      if (s.events && Array.isArray(s.events)) {
        for (const ev of s.events) {
          const item = normalizeAgentEvent(ev);
          if (item && !seenIds.has(item.id)) {
            seenIds.add(item.id);
            newItems.push(item);
          }
        }
      }

      const groupedActivity = groupActivityItems(newItems);

      let derivedMode: InteractionMode = s.interactionMode || state.interactionMode;
      if (!s.interactionMode && s.events) {
        // Check if classified from events
        for (const ev of s.events) {
          if (ev.type === "agent.status" && ev.status) {
            const up = ev.status.toUpperCase();
            if (up.includes("AGENT")) derivedMode = "AGENT";
            else if (up.includes("PLAN")) derivedMode = "PLAN";
            else if (up.includes("ASK")) derivedMode = "ASK";
            else if (up.includes("CHAT")) derivedMode = "CHAT";
            else if (up.includes("AMBIGUOUS")) derivedMode = "AMBIGUOUS";
          }
        }
      }

      let derivedAgentState: AgentState = (s.agentState as AgentState) || state.agentState;
      if (s.status === "completed") derivedAgentState = "COMPLETED";
      else if (s.status === "failed") derivedAgentState = "FAILED";
      else if (s.status === "cancelled") derivedAgentState = "CANCELLED";
      else if (s.status === "waiting_for_user") derivedAgentState = "WAITING_FOR_USER";

      return {
        ...state,
        taskId: s.taskId !== undefined ? s.taskId : state.taskId,
        prompt: s.prompt !== undefined ? s.prompt : state.prompt,
        selectedModelId: s.modelId || state.selectedModelId,
        status: s.status || state.status,
        interactionMode: derivedMode,
        agentState: derivedAgentState,
        activity: groupedActivity,
        changes: s.changes || state.changes,
        plan: s.plan !== undefined ? s.plan : state.plan,
        verification: s.verification !== undefined ? s.verification : state.verification,
        diagnosis: s.diagnosis !== undefined ? s.diagnosis : state.diagnosis,
        repairAttempts: s.repairAttempts || state.repairAttempts,
        workingSet: s.workingSet || state.workingSet,
        memory: s.memories || state.memory,
        workers: s.subagents || state.workers,
        pendingInteraction: s.pendingInteraction !== undefined ? s.pendingInteraction : state.pendingInteraction,
        gitCommitProposal: s.gitCommitProposal !== undefined ? s.gitCommitProposal : state.gitCommitProposal,
        gitPushProposal: s.gitPushProposal !== undefined ? s.gitPushProposal : state.gitPushProposal,
        finalResponse: s.finalResponse !== undefined ? s.finalResponse : state.finalResponse,
        startTime: s.startTime || state.startTime,
        completedTime: s.completedTime || state.completedTime,
        durationMs: s.durationMs || state.durationMs,
        estimatedTokens: s.estimatedTokens || state.estimatedTokens,
        cancellation: {
          requested: s.status === "cancelling" || (state.cancellation.requested && s.status === "running"),
          acknowledged: s.status === "cancelled"
        }
      };
    }

    case "SELECT_TAB":
    case "SET_ACTIVE_TAB":
      return {
        ...state,
        activeNavTab: action.payload
      };

    case "SELECT_REQUESTED_MODE":
      return {
        ...state,
        requestedMode: action.payload
      };

    case "SELECT_MODEL":
      return {
        ...state,
        selectedModelId: action.payload
      };

    case "REQUEST_CANCEL":
    case "REQUEST_CANCELLATION":
      return {
        ...state,
        status: "cancelling",
        cancellation: {
          requested: true,
          acknowledged: false
        }
      };

    case "TOGGLE_CONTEXT_DRAWER":
      return {
        ...state,
        contextDrawerOpen: action.payload !== undefined ? action.payload : !state.contextDrawerOpen
      };

    case "SET_PROVIDERS":
      return {
        ...state,
        providers: action.payload || []
      };

    default:
      return state;
  }
}
