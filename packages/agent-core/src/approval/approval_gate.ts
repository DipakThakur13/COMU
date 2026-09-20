import { resolve as resolvePath, posix as posixPath } from "path";
import {
  AgentEvent,
  ApprovalDecisionReason,
  ApprovalKind,
  ApprovalPayload,
  ApprovalScopeOption,
  TaskAutonomy
} from "@comu/protocol";
import { ToolCapability, ToolApprovalRequirement } from "@comu/tool-core";
import { InteractionManager, ApprovalDecision } from "../interaction_manager.js";

export interface ApprovalGateToolInfo {
  name: string;
  capabilities: ToolCapability[];
  requiresApproval?: ToolApprovalRequirement;
}

export interface ApprovalGateOptions {
  taskId: string;
  autonomy: TaskAutonomy;
  workspaceRoot: string;
  interactionManager?: InteractionManager;
  onEvent: (event: AgentEvent) => void;
  abortSignal?: AbortSignal;
  /** Returns true while a human can see the task (an event stream subscriber is attached). */
  hasHumanObserver?: () => boolean;
  /**
   * Grace period for an observer to attach before the task counts as headless. The panel
   * subscribes after task creation, so the first approval can otherwise race the subscription.
   */
  observerGraceMs?: number;
  /** Bounded wait for a decision. Expiry is a denial, never an implicit approval. */
  timeoutMs: number;
  createUnifiedDiff: (path: string, original: string, proposed: string) => string;
}

export interface BaselineInfo {
  exists: boolean;
  content?: string;
}

export interface GateDecision {
  approved: boolean;
  reason: ApprovalDecisionReason;
  scopeKey?: string;
  message: string;
}

const MAX_DIFF_CHARS = 20_000;
const SHORT_COMMAND_ARGS = 6;

/**
 * The single place that decides whether a model-originated tool call needs a human, builds the
 * reviewable payload for the card, remembers "approve for session" grants, and turns the answer
 * (or its absence) into a decision the orchestrator can act on.
 */
export class ApprovalGate {
  private readonly grants = new Set<string>();
  /**
   * Once a task has been judged headless we do not pay the observer grace wait again: a run with
   * no panel attached would otherwise stall for the grace period on every single approval.
   * The verdict is sticky per task, and only in the headless direction.
   */
  private headless = false;

  constructor(private readonly options: ApprovalGateOptions) {}

  public get autonomy(): TaskAutonomy {
    return this.options.autonomy;
  }

  /** Does this tool call need a human decision under the current autonomy level? */
  public requiresApproval(tool: ApprovalGateToolInfo): boolean {
    if (tool.requiresApproval === "always") return true;
    if (this.options.autonomy !== "ask") return false; // auto: no gate; readonly: the contract already forbids mutation
    return tool.capabilities.includes("write") || tool.capabilities.includes("execute");
  }

  // ---------------------------------------------------------------------------------------
  // Scope keys
  // ---------------------------------------------------------------------------------------

  public static normalizeRelativePath(p: string): string {
    const unified = String(p || "").replace(/\\/g, "/");
    const normalized = posixPath.normalize(unified).replace(/^\.\//, "").replace(/^\/+/, "");
    return normalized === "." ? "" : normalized;
  }

  /**
   * Command grant key: executable plus the full normalised argument vector for short commands, so
   * `npm run build` and `npm run deploy` are distinct grants. Long argument vectors keep the first
   * two arguments and the count, which still separates subcommands.
   */
  public static commandKey(executable: string, args: unknown): string {
    const exe = String(executable || "").trim().toLowerCase().split(/[/\\]/).pop() || "";
    const list = Array.isArray(args) ? args.map(a => String(a).trim()).filter(a => a.length > 0) : [];
    if (list.length <= SHORT_COMMAND_ARGS) {
      return `cmd:${[exe, ...list].join(" ")}`;
    }
    return `cmd:${[exe, ...list.slice(0, 2)].join(" ")} (+${list.length - 2} more args)`;
  }

  /** Every grant key that would cover this call, most specific first. */
  public static matchingKeys(payload: ApprovalPayload): string[] {
    if (payload.file) {
      const rel = ApprovalGate.normalizeRelativePath(payload.file.path);
      const keys = [`file:${rel}`];
      const parts = rel.split("/");
      parts.pop();
      while (parts.length > 0) {
        keys.push(`dir:${parts.join("/")}/`);
        parts.pop();
      }
      keys.push("dir:/");
      keys.push("writes:*");
      return keys;
    }
    if (payload.command) {
      return [ApprovalGate.commandKey(payload.command.executable, payload.command.args)];
    }
    if (payload.kind === "git_push") {
      return []; // never grantable for a session
    }
    return [`tool:${payload.tool}`];
  }

  /** The breadth choices offered on the card. Each has its own key and its own label. */
  public static scopeOptions(payload: ApprovalPayload): ApprovalScopeOption[] {
    if (payload.file) {
      const rel = ApprovalGate.normalizeRelativePath(payload.file.path);
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      const options: ApprovalScopeOption[] = [
        { key: `file:${rel}`, label: `Approve writes to ${rel} for this session` }
      ];
      if (dir) {
        options.push({ key: `dir:${dir}/`, label: `Approve writes under ${dir}/ for this session` });
      }
      options.push({ key: "writes:*", label: "Approve all writes for this session" });
      return options;
    }
    if (payload.command) {
      const key = ApprovalGate.commandKey(payload.command.executable, payload.command.args);
      return [{ key, label: `Approve this exact command for this session` }];
    }
    if (payload.kind === "git_push") {
      return [];
    }
    return [{ key: `tool:${payload.tool}`, label: `Approve ${payload.tool} for this session` }];
  }

  /** Returns the grant key that already covers this call, if any. */
  public findGrant(payload: ApprovalPayload): string | undefined {
    return ApprovalGate.matchingKeys(payload).find(key => this.grants.has(key));
  }

  public grant(scopeKey: string) {
    this.grants.add(scopeKey);
  }

  public listGrants(): string[] {
    return Array.from(this.grants);
  }

  // ---------------------------------------------------------------------------------------
  // Payload
  // ---------------------------------------------------------------------------------------

  public buildPayload(tool: ApprovalGateToolInfo, args: any, baseline?: BaselineInfo): ApprovalPayload {
    const a = args && typeof args === "object" ? args : {};
    let payload: ApprovalPayload;

    if (tool.name === "write_file" || tool.name === "create_file") {
      const path = String(a.path ?? "");
      const proposed = typeof a.content === "string" ? a.content : String(a.content ?? "");
      payload = this.filePayload("file_write", tool.name, path, proposed, baseline);
    } else if (tool.name === "edit_file") {
      const path = String(a.path ?? "");
      const applied = ApprovalGate.applyEdits(baseline?.content ?? "", Array.isArray(a.edits) ? a.edits : []);
      payload = this.filePayload("file_edit", tool.name, path, applied.content, baseline, applied.note);
    } else if (tool.name === "execute_command") {
      const executable = String(a.executable ?? "");
      const argv = Array.isArray(a.args) ? a.args.map((x: unknown) => String(x)) : [];
      const cwd = resolvePath(this.options.workspaceRoot, typeof a.cwd === "string" && a.cwd ? a.cwd : ".");
      payload = {
        kind: "command",
        tool: tool.name,
        summary: `Run ${[executable, ...argv].join(" ")}`.trim(),
        command: { executable, args: argv, cwd },
        scopes: []
      };
    } else if (tool.name === "git_push") {
      payload = {
        kind: "git_push",
        tool: tool.name,
        summary: `Push ${a.branch ? `branch ${a.branch}` : "current branch"} to ${a.remote || "origin"}`,
        details: a,
        scopes: []
      };
    } else if (tool.name === "git_commit") {
      payload = {
        kind: "git_commit",
        tool: tool.name,
        summary: `Commit: ${String(a.message ?? "").split("\n")[0]}`,
        details: a,
        scopes: []
      };
    } else {
      payload = {
        kind: "tool",
        tool: tool.name,
        summary: `Run tool ${tool.name}`,
        details: a,
        scopes: []
      };
    }

    payload.scopes = ApprovalGate.scopeOptions(payload);
    return payload;
  }

  private filePayload(
    kind: ApprovalKind,
    tool: string,
    path: string,
    proposed: string,
    baseline?: BaselineInfo,
    note?: string
  ): ApprovalPayload {
    const exists = !!baseline?.exists;
    const original = exists ? baseline?.content ?? "" : "";
    let diff = this.options.createUnifiedDiff(path, original, proposed);
    let truncated = false;
    if (diff.length > MAX_DIFF_CHARS) {
      diff = diff.slice(0, MAX_DIFF_CHARS) + "\n... [diff truncated]";
      truncated = true;
    }
    const counts = ApprovalGate.countChanges(diff);
    const operation = exists ? "MODIFY" : "CREATE";
    return {
      kind,
      tool,
      summary: `${operation === "CREATE" ? "Create" : "Modify"} ${ApprovalGate.normalizeRelativePath(path)} (+${counts.additions} -${counts.deletions})`,
      file: { path, operation, diff, additions: counts.additions, deletions: counts.deletions, truncated, note },
      scopes: []
    };
  }

  /** Mirrors EditFileTool's exact-match replacement so the diff shows what will land. */
  public static applyEdits(content: string, edits: Array<{ oldText?: string; newText?: string }>): { content: string; note?: string } {
    let current = content;
    const problems: string[] = [];
    edits.forEach((edit, index) => {
      const oldText = String(edit?.oldText ?? "");
      const newText = String(edit?.newText ?? "");
      const occurrences = oldText ? current.split(oldText).length - 1 : 0;
      if (occurrences === 1) {
        current = current.replace(oldText, newText);
      } else if (occurrences === 0) {
        problems.push(`edit ${index + 1}: oldText not found (the tool will fail)`);
      } else {
        problems.push(`edit ${index + 1}: oldText matches ${occurrences} times (the tool will fail)`);
      }
    });
    return { content: current, note: problems.length ? problems.join("; ") : undefined };
  }

  public static countChanges(unifiedDiff: string): { additions: number; deletions: number } {
    let additions = 0;
    let deletions = 0;
    for (const line of unifiedDiff.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }
    return { additions, deletions };
  }

  // ---------------------------------------------------------------------------------------
  // Decision
  // ---------------------------------------------------------------------------------------

  /**
   * Asks the human, honours session grants, and defines the no-human case: with no event stream
   * subscriber attached, or after the bounded wait, the answer is a denial.
   */
  public async decide(payload: ApprovalPayload): Promise<GateDecision> {
    const existing = this.findGrant(payload);
    if (existing) {
      const decision: GateDecision = { approved: true, reason: "SESSION_GRANT", scopeKey: existing, message: `Covered by session grant ${existing}` };
      this.record(payload, decision);
      return decision;
    }

    if (this.options.hasHumanObserver && !(await this.waitForObserver())) {
      const decision: GateDecision = {
        approved: false,
        reason: "NO_HUMAN_OBSERVER",
        message: "No one is watching this task, so the action was not approved. Attach the COMU panel and retry, or run the task with autonomy 'auto' if no supervision is wanted."
      };
      this.record(payload, decision);
      return decision;
    }

    if (!this.options.interactionManager) {
      const decision: GateDecision = {
        approved: false,
        reason: "NO_INTERACTION_CHANNEL",
        message: "This runtime has no interaction channel, so approval could not be requested."
      };
      this.record(payload, decision);
      return decision;
    }

    const answer: ApprovalDecision = await this.options.interactionManager.requestApprovalDecision(
      this.options.taskId,
      `Approval required: ${payload.summary}`,
      ApprovalGate.describe(payload),
      this.options.timeoutMs,
      this.options.onEvent,
      this.options.abortSignal,
      payload
    );

    let decision: GateDecision;
    if (answer.reason === "APPROVED_SESSION") {
      const valid = payload.scopes.some(s => s.key === answer.scopeKey);
      if (valid && answer.scopeKey) {
        this.grant(answer.scopeKey);
        decision = { approved: true, reason: "APPROVED_SESSION", scopeKey: answer.scopeKey, message: `Approved and granted ${answer.scopeKey} for this session` };
      } else {
        decision = { approved: true, reason: "APPROVED", message: `Approved once (unknown scope key '${answer.scopeKey}' was ignored)` };
      }
    } else if (answer.approved) {
      decision = { approved: true, reason: "APPROVED", message: "Approved by the user" };
    } else if (answer.reason === "TIMEOUT") {
      decision = { approved: false, reason: "TIMEOUT", message: `No decision within ${Math.round(this.options.timeoutMs / 1000)}s; treated as denied.` };
    } else {
      decision = { approved: false, reason: "DENIED", message: "Denied by the user" };
    }
    this.record(payload, decision, answer.interactionId);
    return decision;
  }

  /** True once this task has been judged headless; the verdict is cached for the task. */
  public isHeadless(): boolean {
    return this.headless;
  }

  /** Polls the observer callback for up to observerGraceMs. Rejects if the task is cancelled meanwhile. */
  private async waitForObserver(): Promise<boolean> {
    const check = this.options.hasHumanObserver!;
    if (check()) return true;
    // Already judged headless: answer immediately rather than waiting out the grace period again.
    if (this.headless) return false;
    const grace = this.options.observerGraceMs ?? 3000;
    const deadline = Date.now() + grace;
    while (Date.now() < deadline) {
      if (this.options.abortSignal?.aborted) {
        throw new Error("Task was cancelled while waiting for an observer.");
      }
      await new Promise(r => setTimeout(r, Math.min(50, Math.max(1, deadline - Date.now()))));
      if (check()) return true;
    }
    const observed = check();
    if (!observed) {
      this.headless = true;
    }
    return observed;
  }

  private record(payload: ApprovalPayload, decision: GateDecision, interactionId?: string) {
    this.options.onEvent({
      type: "approval.decided",
      eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      taskId: this.options.taskId,
      timestamp: new Date().toISOString(),
      interactionId,
      tool: payload.tool,
      kind: payload.kind,
      summary: payload.summary,
      approved: decision.approved,
      decision: decision.reason,
      scopeKey: decision.scopeKey,
      path: payload.file?.path,
      command: payload.command ? { executable: payload.command.executable, args: payload.command.args, cwd: payload.command.cwd } : undefined
    } as AgentEvent);
  }

  public static describe(payload: ApprovalPayload): string {
    if (payload.file) {
      const f = payload.file;
      return `${f.operation === "CREATE" ? "Create" : "Modify"} ${f.path}: +${f.additions} -${f.deletions}${f.note ? ` (note: ${f.note})` : ""}. Review the diff below.`;
    }
    if (payload.command) {
      return `Run ${JSON.stringify([payload.command.executable, ...payload.command.args])} in ${payload.command.cwd}. No shell is involved; this is the exact argument vector.`;
    }
    return payload.summary;
  }
}
