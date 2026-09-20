import { ActivityItem, ActivityStatus, ToolCategory } from "./types.js";

/**
 * Turns a raw backend event into one activity item, or null when the event carries no timeline
 * meaning (state the header shows, deltas the streaming buffer owns).
 *
 * Pure: no DOM, no clock, no formatting decisions that belong to a component.
 */
export function normalizeEvent(event: any): ActivityItem | null {
  if (!event || typeof event.type !== "string") return null;

  const id = eventKey(event);
  const timestamp = event.timestamp || new Date(0).toISOString();

  switch (event.type) {
    case "task.started":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "completed",
        title: "Task started",
        shortDescription: "Initialised execution context",
        timestamp
      };

    case "task.mode_resolved":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "completed",
        title: `Mode: ${event.mode}`,
        shortDescription:
          event.source === "explicit"
            ? "Chosen by you"
            : `Classified (${event.source}, confidence ${Math.round((event.confidence ?? 0) * 100)}%)`,
        timestamp,
        details: { reasons: event.reasons }
      };

    case "agent.status": {
      const raw = String(event.status || "");
      const upper = raw.toUpperCase();
      let status: ActivityStatus = "active";
      if (upper === "COMPLETED") status = "completed";
      else if (upper === "FAILED" || upper.includes("ERROR")) status = "failed";
      else if (upper === "CANCELLED") status = "warning";

      let toolCategory: ToolCategory = "Generic";
      if (upper.includes("READ")) toolCategory = "Read";
      else if (upper.includes("SEARCH")) toolCategory = "Search";
      else if (upper.includes("EDIT")) toolCategory = "Edit";
      else if (upper.includes("VERIF")) toolCategory = "Verification";
      else if (upper.includes("DIAG")) toolCategory = "Diagnosis";
      else if (upper.includes("REPAIR")) toolCategory = "Repair";

      return { id, category: "SYSTEM_EVENT", toolCategory, status, title: raw || "Agent status update", timestamp };
    }

    case "tool.started": {
      const toolName = event.tool || "tool";
      const toolCategory = categorizeToolName(toolName);
      const target = event.path || event.filePath || event.command || event.pattern || "";
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory,
        status: "active",
        title: `${toolCategory} started: ${formatTarget(target, toolName)}`,
        shortDescription: target || toolName,
        timestamp,
        details: { tool: toolName }
      };
    }

    case "tool.completed": {
      const toolName = event.tool || "tool";
      const toolCategory = categorizeToolName(toolName);
      const result = event.result as Record<string, unknown> | undefined;
      const failed = !!(result && typeof result === "object" && "error" in result && result.error);
      const target = event.path || event.filePath || (result && ((result as any).path || (result as any).target)) || "";
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory,
        status: failed ? "failed" : "completed",
        title: failed
          ? `${toolCategory} rejected: ${formatTarget(target, toolName)}`
          : `${toolCategory} completed: ${formatTarget(target, toolName)}`,
        shortDescription: failed ? String((result as any).error) : target || toolName,
        timestamp,
        details: { tool: toolName, result }
      };
    }

    case "change.created":
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: event.operation === "CREATE" ? "Create" : "Edit",
        status: "completed",
        title: `${event.operation === "CREATE" ? "Created" : "Modified"} ${shortenPath(event.path)}`,
        shortDescription: event.path,
        timestamp,
        details: { path: event.path, operation: event.operation }
      };

    case "interaction.requested": {
      const interaction = event.interaction || {};
      const approval = interaction.approval;
      return {
        id,
        category: "APPROVAL",
        status: "pending",
        title: approval ? `Approval required: ${approval.summary}` : interaction.title || "Input required",
        shortDescription: interaction.message,
        timestamp,
        details: { interactionId: event.interactionId, kind: approval?.kind }
      };
    }

    case "approval.decided":
      return {
        id,
        category: "APPROVAL",
        status: event.approved ? "completed" : "warning",
        title: event.approved ? `Approved: ${event.summary}` : `Not approved: ${event.summary}`,
        shortDescription: describeDecision(event.decision, event.scopeKey),
        timestamp,
        details: { decision: event.decision, scopeKey: event.scopeKey, tool: event.tool }
      };

    case "plan.created":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "completed",
        title: `Plan generated (v${event.planVersion || 1})`,
        shortDescription: `${event.plan?.steps?.length || 0} steps`,
        timestamp
      };

    case "plan.updated":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "warning",
        title: `Plan revised (v${event.planVersion || 1})`,
        shortDescription: event.mutationReason,
        timestamp
      };

    case "plan.step.started":
      return { id, category: "SYSTEM_EVENT", status: "active", title: `Step started: ${stepLabel(event)}`, timestamp };

    case "plan.step.completed":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "completed",
        title: `Step completed: ${stepLabel(event)}`,
        shortDescription: event.resultSummary,
        timestamp
      };

    case "plan.step.failed":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "failed",
        title: `Step failed: ${stepLabel(event)}`,
        shortDescription: event.error,
        timestamp
      };

    case "verification.started":
      return { id, category: "VALIDATION", toolCategory: "Verification", status: "active", title: "Verification started", timestamp };

    case "verification.completed": {
      const passed = event.result?.status === "PASSED";
      return {
        id,
        category: "VALIDATION",
        toolCategory: "Verification",
        status: passed ? "completed" : "failed",
        title: `Verification ${event.result?.status || "completed"}`,
        shortDescription: event.result?.summary || "",
        timestamp,
        durationMs: event.result?.durationMs
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
        timestamp
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

    case "repair.failed":
      return {
        id,
        category: "REPAIR",
        toolCategory: "Repair",
        status: "failed",
        title: `Repair attempt ${event.attemptNumber} failed`,
        shortDescription: event.reason,
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
        timestamp,
        details: { subagentId: event.subagentId }
      };

    case "subagent.completed":
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: "Worker",
        status: "completed",
        title: `${event.subagentType || "Subagent"} worker completed`,
        shortDescription: event.result?.summary,
        timestamp,
        details: { subagentId: event.subagentId }
      };

    case "subagent.failed":
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: "Worker",
        status: "failed",
        title: `${event.subagentType || "Subagent"} worker failed`,
        shortDescription: event.error,
        timestamp,
        details: { subagentId: event.subagentId }
      };

    case "subagent.cancelled":
      return {
        id,
        category: "TOOL_ACTIVITY",
        toolCategory: "Worker",
        status: "warning",
        title: `${event.subagentType || "Subagent"} worker cancelled`,
        timestamp,
        details: { subagentId: event.subagentId }
      };

    case "command.started":
      return { id, category: "COMMAND_OUTPUT", toolCategory: "Terminal", status: "active", title: "Terminal command started", timestamp };

    case "command.completed":
      return { id, category: "COMMAND_OUTPUT", toolCategory: "Terminal", status: "completed", title: "Terminal command finished", timestamp };

    case "command.failed":
      return { id, category: "COMMAND_OUTPUT", toolCategory: "Terminal", status: "failed", title: "Terminal command failed", timestamp };

    case "command.timeout":
      return { id, category: "COMMAND_OUTPUT", toolCategory: "Terminal", status: "failed", title: "Terminal command timed out", timestamp };

    case "command.cancelled":
      return { id, category: "COMMAND_OUTPUT", toolCategory: "Terminal", status: "warning", title: "Terminal command cancelled", timestamp };

    case "memory.retrieved":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "completed",
        title: `Recalled ${event.count ?? 0} workspace ${event.count === 1 ? "memory" : "memories"}`,
        timestamp
      };

    case "agent.limit_reached":
      return { id, category: "SYSTEM_EVENT", status: "warning", title: `Limit reached: ${event.limit}`, timestamp };

    case "task.completed":
      return { id, category: "SYSTEM_EVENT", status: "completed", title: "Task completed", timestamp };

    case "task.failed":
      return {
        id,
        category: "SYSTEM_EVENT",
        status: "failed",
        title: `Task failed: ${event.payload?.code || "error"}`,
        shortDescription: event.error || event.payload?.message,
        timestamp
      };

    case "task.cancelled":
      return { id, category: "SYSTEM_EVENT", status: "warning", title: "Task cancelled", timestamp };

    default:
      // Model request lifecycle, token deltas and anything unknown carry no timeline entry.
      return null;
  }
}

/** Stable identity for dedupe. Falls back to the type and timestamp when the backend omits an id. */
export function eventKey(event: any): string {
  const task = event.taskId || "task";
  const id = event.eventId || `${event.type}-${event.timestamp || ""}`;
  return `${task}:${id}`;
}

export function categorizeToolName(name: string): ToolCategory {
  const lower = String(name || "").toLowerCase();
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

export function shortenPath(target: string): string {
  if (!target) return "";
  const parts = String(target).replace(/\\/g, "/").split("/");
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : target;
}

function formatTarget(target: string, fallback: string): string {
  return target ? shortenPath(target) : fallback;
}

function stepLabel(event: any): string {
  return event.stepTitle || event.stepId || "step";
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
