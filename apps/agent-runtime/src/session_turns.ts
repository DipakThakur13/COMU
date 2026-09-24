import type { AgentEvent } from "@comu/protocol";
import type { ChangeSet, DiffEngine } from "@comu/diff-engine";
import { relativePath, type Turn, type TurnChange, type TurnStatus, type TurnVerification } from "@comu/session-store";

/**
 * A finished task, as a turn of its session.
 *
 * Built from what the task published and the change set it returned: typed fields only. The mode
 * is the resolved one from task.mode_resolved, the verification is the typed status the task
 * ended with, and the files read are the targets of read_file calls. Nothing is recovered from
 * the wording of a status line.
 */
export interface FinishedTask {
  taskId: string;
  workspaceRoot: string;
  userMessage: string;
  startedAt: string;
  events: AgentEvent[];
  /** The orchestrator's result, when it returned one; absent when the run threw. */
  result?: { status?: string; finalText?: string; error?: string; changeSet?: ChangeSet; verificationResult?: { status?: string; summary?: string } };
  diffEngine: DiffEngine;
}

const VERIFICATIONS = new Set(["PASSED", "FAILED", "PARTIAL", "UNAVAILABLE", "NOT_VERIFIED"]);

export function turnFromTask(task: FinishedTask): Turn {
  const events = task.events as Array<AgentEvent & Record<string, any>>;
  const terminal = [...events].reverse().find(e => e.type === "task.completed" || e.type === "task.failed" || e.type === "task.cancelled");
  const status: TurnStatus = terminal?.type === "task.completed" ? "completed" : terminal?.type === "task.cancelled" ? "cancelled" : "failed";

  const mode = [...events].reverse().find(e => e.type === "task.mode_resolved")?.mode as string | undefined;

  const tools = new Map<string, number>();
  const filesRead: string[] = [];
  for (const event of events) {
    if (event.type !== "tool.started") continue;
    tools.set(event.tool, (tools.get(event.tool) ?? 0) + 1);
    if (event.tool === "read_file" && typeof event.target === "string") {
      const file = relativePath(task.workspaceRoot, event.target);
      if (!filesRead.includes(file)) filesRead.push(file);
    }
  }

  const reported = terminal?.type === "task.completed" ? terminal.verification : undefined;
  const typed = reported ?? task.result?.verificationResult?.status;
  const verification: TurnVerification = typed && VERIFICATIONS.has(typed) ? (typed as TurnVerification) : "NONE";

  const finalText = String((terminal?.type === "task.completed" ? terminal.finalText : undefined) ?? task.result?.finalText ?? "");
  const error =
    terminal?.type === "task.failed"
      ? String(terminal.error ?? terminal.payload?.message ?? task.result?.error ?? "")
      : terminal?.type === "task.cancelled"
        ? String(terminal.reason ?? "cancelled")
        : undefined;

  return {
    turnId: `turn-${task.taskId}`,
    taskId: task.taskId,
    userMessage: task.userMessage,
    ...(mode ? { mode } : {}),
    status,
    finalText,
    ...(error ? { error } : {}),
    changes: changesOf(task, events),
    filesRead,
    tools: [...tools.entries()].map(([tool, calls]) => ({ tool, calls })),
    verification,
    ...(task.result?.verificationResult?.summary ? { verificationSummary: task.result.verificationResult.summary } : {}),
    startedAt: task.startedAt,
    endedAt: terminal?.timestamp ?? new Date().toISOString()
  };
}

/**
 * The files the turn changed, with the diff of the turn's whole change to each.
 *
 * From the change set, which holds each file's content before the turn's first write and after
 * its last. A run that threw returned no change set; its change.created events still name the
 * files, so those are kept without a diff rather than lost.
 */
function changesOf(task: FinishedTask, events: Array<AgentEvent & Record<string, any>>): TurnChange[] {
  const changes: TurnChange[] = [];
  const recorded = task.result?.changeSet?.changes;
  if (recorded instanceof Map && recorded.size > 0) {
    for (const change of recorded.values()) {
      const original = change.originalContent ?? "";
      if (change.operation === "MODIFY" && original === change.newContent) continue;
      const path = relativePath(task.workspaceRoot, change.path);
      const diff = task.diffEngine.createUnifiedDiff(path, original, change.newContent);
      const { additions, deletions } = countLines(diff);
      changes.push({
        path,
        operation: change.operation,
        ...(change.originalHash ? { originalHash: change.originalHash } : {}),
        ...(change.newHash ? { newHash: change.newHash } : {}),
        additions,
        deletions,
        diff,
        diffTruncated: false
      });
    }
    return changes;
  }

  for (const event of events) {
    if (event.type !== "change.created" || typeof event.path !== "string") continue;
    const path = relativePath(task.workspaceRoot, event.path);
    if (changes.some(c => c.path === path)) continue;
    changes.push({
      path,
      operation: event.operation === "CREATE" ? "CREATE" : "MODIFY",
      additions: Number(event.additions ?? 0),
      deletions: Number(event.deletions ?? 0),
      diff: "",
      diffTruncated: true
    });
  }
  return changes;
}

function countLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}
