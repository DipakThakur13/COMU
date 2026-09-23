import { ActivityItem, ActivityStatus, ErrorView, ToolCategory } from "./types.js";

/**
 * Turns a raw backend event into one row of the activity stream, or null when the event is not
 * something that happened.
 *
 * The rule the old mapping broke: a row is an action the agent took, never a state the loop passed
 * through. "Executing tools", "Observing results" and "Thinking" describe what is happening now,
 * which is the live status line's job (see `LiveStatus`); a tool's start and its completion are one
 * action and get one row between them; a file write is reported by the change it produced, not
 * twice, once by the tool and once by the change.
 *
 * Pure: no DOM, no clock, no formatting decisions that belong to a component.
 */
export interface NormalizeContext {
  /** The resolved interaction mode. In CHAT the stream is the conversation and nothing else. */
  mode?: string;
  /** The limit the runtime reported, so a failure row can say which one in plain language. */
  limit?: string;
}

export function normalizeEvent(event: any, context: NormalizeContext = {}): ActivityItem | null {
  if (!event || typeof event.type !== "string") return null;

  const item = buildItem(event, context);
  if (!item) return null;

  // A conversational reply is a conversation. Nothing that is not an outcome earns a row in CHAT,
  // which is what turned one sentence of answer into six rows of pipeline.
  if (context.mode === "CHAT" && !(item.level === "outcome" && item.status !== "completed")) {
    return null;
  }
  return item;
}

function buildItem(event: any, context: NormalizeContext): ActivityItem | null {
  const id = eventKey(event);
  const timestamp = event.timestamp || new Date(0).toISOString();

  switch (event.type) {
    // ── State, not history ─────────────────────────────────────────────────────────────────────
    //
    // Each of these says where the loop is, and the header and the live status line already say
    // that. A start is paired with its completion below; a limit is the reason a failure row will
    // give, not a row of its own.
    case "task.started":
    case "task.mode_resolved":
    case "agent.status":
    case "tool.started":
    case "verification.started":
    case "repair.started":
    case "plan.created":
    case "plan.step.started":
    case "plan.step.completed":
    case "command.started":
    case "command.completed":
    case "memory.retrieved":
    case "agent.limit_reached":
      return null;

    case "tool.completed":
      return toolRow(event, id, timestamp);

    case "change.created": {
      const created = event.operation === "CREATE";
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: created ? "Create" : "Edit",
        level: "substance",
        status: "completed",
        title: `${created ? "Created" : "Edited"} ${basename(event.path)}`,
        shortDescription: event.path,
        metric: diffMetric(event.additions, event.deletions),
        timestamp,
        details: { path: event.path, operation: event.operation }
      };
    }

    case "interaction.requested": {
      const interaction = event.interaction || {};
      const approval = interaction.approval;
      return {
        id,
        category: "APPROVAL",
        level: "outcome",
        status: "pending",
        title: approval ? approval.summary : interaction.title || "Input required",
        shortDescription: approval ? "Waiting for your decision" : interaction.message,
        timestamp,
        details: { interactionId: event.interactionId, kind: approval?.kind }
      };
    }

    case "approval.decided":
      return {
        id,
        category: "APPROVAL",
        level: "substance",
        status: event.approved ? "completed" : "warning",
        title: event.approved ? `Approved: ${event.summary}` : `Not approved: ${event.summary}`,
        shortDescription: describeDecision(event.decision, event.scopeKey),
        timestamp,
        details: { decision: event.decision, scopeKey: event.scopeKey, tool: event.tool }
      };

    // The plan itself lives in the ribbon above the stream, which is where a step's progress is
    // read. A revision is the exception: the plan a person was watching is no longer that plan.
    case "plan.updated":
      return {
        id,
        category: "SYSTEM_EVENT",
        level: "substance",
        status: "warning",
        title: `Plan revised to v${event.planVersion || 1}`,
        shortDescription: event.mutationReason,
        timestamp
      };

    case "plan.step.failed":
      return {
        id,
        category: "SYSTEM_EVENT",
        level: "substance",
        status: "failed",
        title: `Step failed: ${event.stepTitle || event.stepId || "step"}`,
        shortDescription: event.error,
        timestamp
      };

    case "verification.completed": {
      const result = event.result || {};
      const checks: any[] = Array.isArray(result.checks) ? result.checks : [];
      const failed = checks.filter(c => c.status === "FAILED");
      const passed = result.status === "PASSED";
      return {
        id,
        category: "VALIDATION",
        toolCategory: "Verification",
        level: "substance",
        status: passed ? "completed" : "failed",
        title: passed ? "Verification passed" : "Verification failed",
        shortDescription: result.summary || undefined,
        metric: passed
          ? checks.length > 0
            ? `${checks.length} ${checks.length === 1 ? "check" : "checks"}`
            : undefined
          : failed.length > 0
            ? `${failed.length} failed`
            : undefined,
        timestamp,
        durationMs: result.durationMs,
        details: { checks }
      };
    }

    case "diagnosis.created": {
      const diagnosis = event.diagnosis || {};
      return {
        id,
        category: "DIAGNOSIS",
        toolCategory: "Diagnosis",
        level: "substance",
        status: "warning",
        title: `Diagnosed ${humanise(diagnosis.failureType)?.toLowerCase() || "the failure"}`,
        shortDescription: diagnosis.summary,
        timestamp,
        details: { affectedFiles: diagnosis.affectedFiles }
      };
    }

    case "repair.completed":
    case "repair.failed": {
      const failed = event.type === "repair.failed";
      return {
        id,
        category: "REPAIR",
        toolCategory: "Repair",
        level: "substance",
        status: failed ? "failed" : "completed",
        title: `Repair attempt ${event.attemptNumber}`,
        shortDescription: failed ? event.reason : event.outcome,
        timestamp
      };
    }

    // A worker is long-running, so it gets its row when it starts and that row is updated in place
    // when it ends. The stable id is what makes the update an update rather than a second row.
    case "subagent.started":
      return {
        id: workerRowId(event.subagentId),
        category: "TOOL_ACTIVITY",
        toolCategory: "Worker",
        level: "substance",
        status: "active",
        title: `${humanise(event.subagentType) || "Subagent"} worker`,
        shortDescription: event.goal,
        timestamp,
        details: { subagentId: event.subagentId }
      };

    case "subagent.completed":
    case "subagent.failed":
    case "subagent.cancelled": {
      const status: ActivityStatus =
        event.type === "subagent.completed" ? "completed" : event.type === "subagent.failed" ? "failed" : "warning";
      return {
        id: workerRowId(event.subagentId),
        category: "TOOL_ACTIVITY",
        toolCategory: "Worker",
        level: "substance",
        status,
        title: `${humanise(event.subagentType) || "Subagent"} worker`,
        shortDescription: event.result?.summary || event.error || (status === "warning" ? "Cancelled" : undefined),
        timestamp,
        details: { subagentId: event.subagentId }
      };
    }

    case "command.failed":
    case "command.timeout":
    case "command.cancelled": {
      const cancelled = event.type === "command.cancelled";
      return {
        id,
        category: "COMMAND_OUTPUT",
        toolCategory: "Terminal",
        level: "substance",
        status: cancelled ? "warning" : "failed",
        title: cancelled ? "Command cancelled" : event.type === "command.timeout" ? "Command timed out" : "Command failed",
        timestamp
      };
    }

    // ── Outcomes ───────────────────────────────────────────────────────────────────────────────
    case "task.completed":
      return {
        id,
        category: "SYSTEM_EVENT",
        level: "outcome",
        status: "completed",
        title: "Task complete",
        timestamp
      };

    case "task.failed":
      return {
        id,
        category: "SYSTEM_EVENT",
        level: "outcome",
        status: "failed",
        title: "Task failed",
        shortDescription: describeFailure(
          { code: event.payload?.code || "TASK_FAILED", message: event.payload?.message || event.error || "" },
          context.limit
        ),
        timestamp,
        details: { code: event.payload?.code }
      };

    case "task.cancelled":
      return {
        id,
        category: "SYSTEM_EVENT",
        level: "outcome",
        status: "warning",
        title: "Stopped",
        shortDescription: "You stopped the task",
        timestamp
      };

    default:
      // Model request lifecycle, token deltas and anything unknown carry no row.
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------------------------

/**
 * One finished tool call as one row.
 *
 * A successful write produces no row here: `change.created` follows it and says the same thing
 * with the file's name and its size, and two rows for one edit is exactly the repetition this
 * stream is being cured of. A failed write still belongs to the tool, because no change followed.
 */
function toolRow(event: any, id: string, timestamp: string): ActivityItem | null {
  const tool = String(event.tool || "tool");
  const category = categorizeToolName(tool);
  const result = event.result;
  const error = toolErrorMessage(result);
  const target = String(event.target || resultPath(result) || "");

  if (error) {
    return {
      id,
      category: "TOOL_ACTIVITY",
      toolCategory: category,
      level: "substance",
      status: "failed",
      title: target ? `${failedVerb(category, tool)} ${shortenPath(target)}` : `${failedVerb(category, tool)}`,
      shortDescription: error,
      timestamp,
      details: { tool, target }
    };
  }

  switch (category) {
    case "Read":
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: "Read",
        level: "routine",
        status: "completed",
        title: `Read ${basename(target) || "a file"}`,
        shortDescription: target || undefined,
        metric: countMetric(result?.lineCount, "line"),
        timestamp,
        details: { tool, path: target }
      };

    case "Explore":
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: "Explore",
        level: "routine",
        status: "completed",
        title: `Explored ${shortenPath(target) || "the workspace"}`,
        shortDescription: target || undefined,
        metric: countMetric(entryCount(result), "entry", "entries"),
        timestamp,
        details: { tool, path: target }
      };

    case "Search": {
      const matches: any[] = Array.isArray(result?.matches) ? result.matches : [];
      const files = new Set(matches.map(m => m?.path || m?.file).filter(Boolean));
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: "Search",
        level: "routine",
        status: "completed",
        title: target ? `Searched "${target}"` : "Searched the repository",
        shortDescription: matches.length === 0 ? "No matches" : undefined,
        metric:
          matches.length > 0
            ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}${files.size > 1 ? ` in ${files.size} files` : ""}`
            : undefined,
        timestamp,
        details: { tool, query: target, matches: matches.slice(0, 50) }
      };
    }

    case "Terminal": {
      const commandLine = commandText(result) || target || tool;
      const exitCode = typeof result?.exitCode === "number" ? result.exitCode : undefined;
      return {
        id,
        category: "COMMAND_OUTPUT",
        toolCategory: "Terminal",
        level: "substance",
        status: exitCode === undefined || exitCode === 0 ? "completed" : "failed",
        title: commandLine,
        metric: exitCode !== undefined && exitCode !== 0 ? `exit ${exitCode}` : undefined,
        timestamp,
        durationMs: typeof result?.durationMs === "number" ? result.durationMs : undefined,
        details: { tool, stdout: result?.stdout, stderr: result?.stderr, exitCode }
      };
    }

    // The change the write produced is the row. See the note above.
    case "Edit":
    case "Write":
    case "Create":
      return null;

    // delegate_subtask has its own subagent lifecycle events, which carry the goal and the result.
    case "Worker":
      return null;

    default:
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: category,
        level: "routine",
        status: "completed",
        title: humanise(tool) || tool,
        shortDescription: target || undefined,
        timestamp,
        details: { tool, target }
      };
  }
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

/** Stable identity for dedupe. Falls back to the type and timestamp when the backend omits an id. */
export function eventKey(event: any): string {
  const task = event.taskId || "task";
  const id = event.eventId || `${event.type}-${event.timestamp || ""}`;
  return `${task}:${id}`;
}

/** The row a worker owns for its whole life, so completing it updates its row rather than adding one. */
export function workerRowId(subagentId: string | undefined): string {
  return `worker-${subagentId || "unknown"}`;
}

export function categorizeToolName(name: string): ToolCategory {
  const lower = String(name || "").toLowerCase();
  if (lower.includes("list_dir") || lower.includes("directory") || lower.includes("tree") || lower.includes("explore")) return "Explore";
  if (lower.includes("read")) return "Read";
  if (lower.includes("search") || lower.includes("find") || lower.includes("grep")) return "Search";
  if (lower.includes("edit") || lower.includes("replace") || lower.includes("patch")) return "Edit";
  if (lower.includes("write")) return "Write";
  if (lower.includes("create")) return "Create";
  if (lower.includes("terminal") || lower.includes("exec") || lower.includes("bash") || lower.includes("cmd")) return "Terminal";
  if (lower.includes("git")) return "Git";
  if (lower.includes("verif") || lower.includes("test") || lower.includes("lint") || lower.includes("build") || lower.includes("typecheck")) return "Verification";
  if (lower.includes("diag")) return "Diagnosis";
  if (lower.includes("repair")) return "Repair";
  if (lower.includes("worker") || lower.includes("subagent") || lower.includes("delegate")) return "Worker";
  return "Generic";
}

/**
 * The state machine's names, as a person would say them.
 *
 * Used by the live status line and by the header. "CLASSIFYING" and "TOOL_CALLING" are the loop's
 * vocabulary; nothing outside the runtime should ever read them.
 */
const STATE_WORDS: Record<string, string> = {
  STARTING: "Starting",
  CLASSIFYING: "Reading your request",
  ANALYZING: "Analysing the workspace",
  PLANNING: "Planning",
  THINKING: "Thinking",
  TOOL_CALLING: "Working",
  OBSERVING: "Reading results",
  VERIFYING: "Verifying",
  DIAGNOSING: "Diagnosing",
  REPAIRING: "Repairing",
  WAITING_FOR_USER: "Waiting for you"
};

export function humanAgentState(state: string | undefined): string | undefined {
  return state ? STATE_WORDS[String(state).toUpperCase()] : undefined;
}

/** What the live line says while a tool runs. Present tense, because it is still happening. */
export function liveToolLabel(tool: string, target?: string): string {
  const category = categorizeToolName(tool);
  const name = target ? shortenPath(target) : "";
  switch (category) {
    case "Read":
      return name ? `Reading ${name}` : "Reading";
    case "Explore":
      return name ? `Exploring ${name}` : "Exploring the workspace";
    case "Search":
      return target ? `Searching for "${target}"` : "Searching";
    case "Edit":
    case "Write":
      return name ? `Editing ${name}` : "Editing";
    case "Create":
      return name ? `Creating ${name}` : "Creating a file";
    case "Terminal":
      return target ? `Running ${target}` : "Running a command";
    case "Verification":
      return "Verifying";
    case "Worker":
      return "Delegating to a worker";
    default:
      return humanise(tool) || "Working";
  }
}

/**
 * Why a task failed, in a sentence.
 *
 * One implementation, used by the failure row and by the header, so the two can never disagree
 * about what went wrong.
 */
const LIMIT_WORDS: Record<string, string> = {
  maxSteps: "step limit reached",
  maxExecutionTimeMs: "time limit reached",
  maxToolCalls: "tool call limit reached",
  maxIterations: "iteration limit reached",
  duplicateRepairStrategy: "the same repair was tried twice"
};

const FAILURE_WORDS: Record<string, string> = {
  LIMIT_REACHED: "execution limit reached",
  DUPLICATE_REPAIR_STRATEGY: "the same repair was tried twice with the same result",
  WORKSPACE_STATE_UNKNOWN: "a write failed and the workspace could not be checked",
  WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE: "the workspace changed after a tool failed",
  VERIFICATION_FAILED: "verification did not pass",
  NO_PROVIDER: "no model provider is configured",
  CANCELLED: "the task was stopped"
};

export function describeFailure(error: Pick<ErrorView, "code" | "message"> | undefined, limit?: string): string | undefined {
  if (!error) return undefined;
  const byLimit = limit ? LIMIT_WORDS[limit] : undefined;
  if (byLimit) return byLimit;
  const byCode = FAILURE_WORDS[error.code];
  if (byCode) return byCode;
  return error.message || undefined;
}

/** "+12 −3", or nothing at all when the size of the change was not reported. */
export function diffMetric(additions?: number, deletions?: number): string | undefined {
  if (typeof additions !== "number" && typeof deletions !== "number") return undefined;
  return `+${additions ?? 0} −${deletions ?? 0}`;
}

export function shortenPath(target: string): string {
  if (!target) return "";
  const parts = String(target).replace(/\\/g, "/").split("/");
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : target;
}

export function basename(target: string | undefined): string {
  if (!target) return "";
  const parts = String(target).replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || target;
}

/** "read_file" and "RESEARCH" become "Read file" and "Research": snake and shout, spoken aloud. */
function humanise(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const words = String(value).replace(/[_-]+/g, " ").trim().toLowerCase();
  if (!words) return undefined;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function failedVerb(category: ToolCategory, tool: string): string {
  switch (category) {
    case "Read":
      return "Could not read";
    case "Explore":
      return "Could not explore";
    case "Search":
      return "Search failed:";
    case "Edit":
    case "Write":
      return "Could not edit";
    case "Create":
      return "Could not create";
    case "Terminal":
      return "Command failed:";
    default:
      return `${humanise(tool) || tool} failed`;
  }
}

function countMetric(value: unknown, singular: string, plural?: string): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return `${value} ${value === 1 ? singular : plural ?? `${singular}s`}`;
}

function entryCount(result: unknown): number | undefined {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === "object" && Array.isArray((result as any).entries)) {
    return (result as any).entries.length;
  }
  return undefined;
}

function commandText(result: any): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const executable = typeof result.executable === "string" ? result.executable : undefined;
  if (!executable) return undefined;
  const args = Array.isArray(result.args) ? result.args : [];
  return [executable, ...args].join(" ");
}

function toolErrorMessage(result: any): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const error = (result as any).error;
  if (!error) return undefined;
  return typeof error === "string" ? error : String(error);
}

function resultPath(result: any): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const candidate = (result as any).path ?? (result as any).filePath;
  return typeof candidate === "string" ? candidate : undefined;
}

function describeDecision(decision: string, scopeKey?: string): string {
  switch (decision) {
    case "APPROVED":
      return "Approved once";
    case "APPROVED_SESSION":
      return `Approved for this session (${scopeKey})`;
    case "SESSION_GRANT":
      return `Covered by session grant (${scopeKey})`;
    case "DENIED":
      return "Denied; the agent was told and can adapt";
    case "TIMEOUT":
      return "No decision in time, treated as denied";
    case "NO_HUMAN_OBSERVER":
      return "Nobody was watching, treated as denied";
    case "NO_INTERACTION_CHANNEL":
      return "No approval channel available, treated as denied";
    default:
      return decision;
  }
}
