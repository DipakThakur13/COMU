import type { TaskAutonomy } from "@comu/protocol";
import type { TurnContext } from "@comu/session-store";

/**
 * The instructions an agent task runs under.
 *
 * It used to be one sentence: "You are an AI software engineer. Follow instructions precisely." The
 * model was never told where it was, what its tools were for, that a write could be refused, what
 * finishing meant, or that the files it left behind count. B0 shows each gap: a task that left a
 * scratch file behind failed on it (t2-ts-endpoint), and a completion was claimed with nothing
 * checked.
 *
 * Built from what the task can actually do: only the tools it is offered are described, so a
 * read-only task is never told how to write.
 */
export interface SystemPromptInput {
  workspaceRoot: string;
  autonomy: TaskAutonomy;
  /** The names of the tools offered to the model on this task, after contract filtering. */
  tools: string[];
  /** Whether the task is expected to change files (from the contract). */
  expectedMutation: boolean;
  /** The session this turn continues. Absent on a session's first turn. */
  session?: Pick<TurnContext, "workingState" | "lastChange">;
}

/**
 * One part of a system prompt, and whether it may be dropped to make room.
 *
 * Nothing is dropped yet: there is no token budget until Stage 2. The flag exists now so that the
 * compaction work cannot quietly evict the session's working state, which is marked not evictable
 * here, where it is built.
 */
export interface PromptSection {
  id: string;
  text: string;
  evictable: boolean;
}

/** When to reach for each tool, grouped the way a person would choose between them. */
const TOOL_GUIDE: Array<{ names: string[]; guide: string }> = [
  {
    names: ["get_workspace_tree", "list_directory", "search_text", "read_file"],
    guide:
      "Finding your way: get_workspace_tree for the layout, list_directory for one folder, search_text to find where a symbol or string is used, read_file to read a file. Search before reading many files, and read a file before you change it."
  },
  {
    names: ["edit_file", "write_file", "create_file"],
    guide:
      "Changing files: edit_file for a targeted change to an existing file (preferred, it keeps the rest of the file intact), write_file to replace a file's whole content, create_file for a new file the task needs."
  },
  {
    names: ["run_tests", "run_typecheck", "run_build", "run_linter"],
    guide:
      "Checking your work: run_tests, run_typecheck, run_build and run_linter run the project's own configured commands. Use them to confirm a change rather than assuming it works."
  },
  {
    names: ["execute_command"],
    guide:
      "execute_command runs one program with arguments, without a shell, in the workspace. Use it when no dedicated tool fits; prefer the dedicated tools above."
  },
  {
    names: ["git_status", "git_diff", "git_create_branch", "git_stage_files", "git_commit", "git_push"],
    guide:
      "Git: git_status and git_diff to see what has changed. Do not stage, commit, branch or push unless the task asks for it."
  },
  { names: ["web_docs"], guide: "web_docs looks up library or API documentation when the code alone does not answer a question." },
  {
    names: ["delegate_subtask"],
    guide: "delegate_subtask hands a bounded read-only investigation to a supervised worker. Use it for a self-contained question, not for the main work."
  }
];

export function buildTaskSystemPrompt(input: SystemPromptInput): string {
  return joinSections(buildTaskSystemPromptSections(input));
}

export function joinSections(sections: PromptSection[]): string {
  return sections.map(s => s.text).join("\n\n");
}

export function buildTaskSystemPromptSections(input: SystemPromptInput): PromptSection[] {
  const offered = new Set(input.tools);
  const out: PromptSection[] = [];
  const sections = { push: (text: string, id = `section-${out.length}`) => out.push({ id, text, evictable: true }) };

  sections.push(
    "You are COMU, a software engineering agent working inside the user's repository. You act through the tools you are given; you cannot see or change anything any other way.",
    "identity"
  );

  sections.push(
    [
      "## The workspace",
      `The workspace root is ${input.workspaceRoot}. Every path you pass to a tool is resolved relative to that root; prefer relative paths such as src/index.ts. A path that resolves outside the root is refused.`
    ].join("\n"),
    "workspace"
  );

  if (input.session) out.push(sessionSection(input.session));

  const guides = TOOL_GUIDE.filter(g => g.names.some(n => offered.has(n))).map(g => `- ${g.guide}`);
  if (guides.length > 0) {
    sections.push(["## Your tools", ...guides].join("\n"));
  }

  const canWrite = ["edit_file", "write_file", "create_file"].some(n => offered.has(n));
  const canRun = offered.has("execute_command");
  if (!canWrite && !canRun) {
    sections.push(
      [
        "## This task is read-only",
        "You cannot change files or run commands on this task. Answer from what you read, and say so if something cannot be determined without running it."
      ].join("\n")
    );
  } else if (input.autonomy === "ask") {
    sections.push(
      [
        "## Approval",
        "Every file change and every command you request is shown to the user and waits for their approval before it happens. A request that is refused comes back to you as APPROVAL_DENIED; a request nobody answers in time is treated the same way. A denial means the user does not want that action: do not repeat it in another form. Propose a different approach, or ask the user how they want to proceed."
      ].join("\n")
    );
  }

  if (canWrite) {
    sections.push(
      [
        "## Leave the workspace as you would want it reviewed",
        "Change only the files the task needs. Do not create scratch files, debugging scripts, notes, backups or copies of files anywhere in the workspace: you have no tool to delete them afterwards, and every file you create is part of your change and will be reviewed as such. If you need to try something, use the project's existing tests and commands."
      ].join("\n")
    );
  }

  sections.push(
    [
      "## Finishing",
      input.expectedMutation
        ? "You are finished when the change the task asks for is made and you have checked it with the project's tests or checks. When you stop calling tools, your final message is your report: say what you changed, in which files, and how you checked it. After you finish, COMU runs its own verification; it decides whether the task is verified, not your report."
        : "When you stop calling tools, your final message is your answer. Base it on what you actually read.",
      "Never claim something you have not seen happen. If you did not run the tests, do not say they pass. If a check failed or could not run, say so plainly. An honest report of an unfinished task is better than a claim of a finished one."
    ].join("\n"),
    "finishing"
  );

  return out;
}

/** A session's earlier turns as the model messages they were; empty on a session's first turn. */
export function sessionHistory(session: Pick<TurnContext, "history"> | undefined): Array<{ role: "user" | "assistant"; content: string }> {
  return (session?.history ?? []).map(m => ({ role: m.role, content: m.content }));
}

const CHECK_WORDS: Record<string, string> = {
  PASSED: "verified, checks passed",
  FAILED: "checks failed",
  PARTIAL: "partly verified",
  UNAVAILABLE: "checks could not run",
  NOT_VERIFIED: "not verified: nothing checked it",
  NONE: "not checked"
};

/**
 * The session's working state, rendered from its typed fields.
 *
 * Every line is something COMU observed: files it read and changed, what each change was checked
 * with, and the most recent change's diff. Never evictable: the history above the current message
 * can be summarised or dropped under a future budget, this cannot.
 */
export function sessionSection(session: NonNullable<SystemPromptInput["session"]>): PromptSection {
  const ws = session.workingState;
  const lines: string[] = [
    "## Earlier in this session",
    "This message continues a conversation in this workspace. The earlier messages are above the current one. What COMU actually did in them is recorded below; it is observed, not remembered, so trust it over the earlier messages where they disagree."
  ];
  if (ws.goal) lines.push("", `The previous request was: ${JSON.stringify(ws.goal)}`);
  if (ws.filesChanged.length > 0) {
    lines.push("", "Files changed in this session:", ...ws.filesChanged.map(f => `- ${f.path}: ${f.summary}`));
  }
  if (ws.filesRead.length > 0) lines.push("", `Files read in this session: ${ws.filesRead.join(", ")}`);
  if (ws.verification.length > 0) {
    lines.push(
      "",
      "What was checked, most recent first:",
      ...ws.verification.map(v => `- ${CHECK_WORDS[v.status] ?? v.status}${v.files.length > 0 ? ` (${v.files.join(", ")})` : ""}${v.summary ? `: ${v.summary}` : ""}`)
    );
  }
  if (ws.decisions.length > 0) lines.push("", "Decisions taken:", ...ws.decisions.map(d => `- ${d}`));
  if (ws.openQuestions.length > 0) lines.push("", "Questions left open:", ...ws.openQuestions.map(q => `- ${q}`));

  const change = session.lastChange;
  if (change) {
    lines.push(
      "",
      "### The most recent change",
      `Made for the request ${JSON.stringify(change.userMessage)}. If you are asked to undo or adjust it, this is what it changed. A file it created can be emptied but not deleted with your tools; say so if asked to remove one.`
    );
    for (const file of change.files) {
      lines.push("", `${file.path} (${file.operation === "CREATE" ? "created" : "modified"}):`);
      lines.push(file.diff ? ["```diff", file.diff.trimEnd(), "```"].join("\n") : "(diff too large to include; read the file)");
    }
    if (change.diffOmitted) lines.push("", "Part of this change is not shown here; read the files before acting on it.");
  }
  return { id: "session", text: lines.join("\n"), evictable: false };
}
