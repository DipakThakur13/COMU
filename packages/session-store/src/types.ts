/**
 * A session: the thread of turns in one workspace, and what they have done so far.
 *
 * Not the memory engine. Memory holds lessons and conventions, queried once at task start and
 * retrieved by text similarity; it answers "what is true about this project". A session answers
 * "what happened in the last few minutes": what was asked, what COMU said and changed, what was
 * checked. The two are kept in separate stores and nothing from a turn is written into memory.
 */

/** How a turn ended. A failed or cancelled turn is still something COMU did, so it is recorded. */
export type TurnStatus = "completed" | "failed" | "cancelled";

/**
 * The typed verification outcome a turn ended with. NONE for a turn that never reached
 * verification, such as a CHAT answer, whose completion carries no verification at all.
 */
export type TurnVerification = "PASSED" | "FAILED" | "PARTIAL" | "UNAVAILABLE" | "NOT_VERIFIED" | "NONE";

/** One file a turn changed, relative to the workspace root with forward slashes. */
export interface TurnChange {
  path: string;
  operation: "CREATE" | "MODIFY";
  /** Content hash before the turn's first change to the file; absent when it did not exist. */
  originalHash?: string;
  /** Content hash after the turn's last change. */
  newHash?: string;
  additions: number;
  deletions: number;
  /** Unified diff of the whole turn's change to this file, bounded. */
  diff: string;
  diffTruncated: boolean;
}

/** A compact record of the tools a turn used: how many calls to each. */
export interface ToolUse {
  tool: string;
  calls: number;
}

export interface Turn {
  turnId: string;
  taskId: string;
  userMessage: string;
  /** The mode the task was resolved to (explicit or classified). */
  mode?: string;
  status: TurnStatus;
  /** The assistant's final text. On a failure, what COMU said went wrong. */
  finalText: string;
  /** COMU's reason for ending, when it did not end cleanly. */
  error?: string;
  changes: TurnChange[];
  filesRead: string[];
  tools: ToolUse[];
  verification: TurnVerification;
  verificationSummary?: string;
  startedAt: string;
  endedAt: string;
  /**
   * Set when the session outgrew its cap and this turn's full text (message, answer, diffs) was
   * dropped to make room. The turn's metadata stays, and so does the working state.
   */
  textDropped?: boolean;
}

/**
 * The rolling state that goes into every turn after the first.
 *
 * Derived from the turns by code, never written by a model: every field here is something COMU
 * observed. Decisions and open questions are typed slots that stay empty until something typed
 * can fill them; they are not inferred from prose.
 *
 * Never evictable. When context compaction arrives, this is the part of the prompt it must keep:
 * the history can be summarised or dropped, the working state is what makes the next turn land
 * against what was actually done.
 */
export interface WorkingState {
  /** The most recent request. */
  goal: string;
  /** Files read in this session, most recent first. */
  filesRead: string[];
  /** Files changed in this session, with a one line summary each. */
  filesChanged: Array<{ path: string; summary: string }>;
  decisions: string[];
  openQuestions: string[];
  /** What was verified and what was not, turn by turn, most recent first. */
  verification: Array<{ taskId: string; status: TurnVerification; files: string[]; summary?: string }>;
}

/** Everything changed across the session, per file, accumulated from each turn's change set. */
export interface SessionChange {
  path: string;
  /** Whether the file existed before the session first changed it. */
  originalExisted: boolean;
  /** Hash before the session first changed it. */
  originalHash?: string;
  /** Hash after the most recent change. Equal to originalHash when the changes were reverted. */
  currentHash?: string;
  /** Turns that changed it, oldest first. */
  taskIds: string[];
  additions: number;
  deletions: number;
}

export interface Session {
  version: 1;
  sessionId: string;
  /** The one workspace this session belongs to. A session is never read for any other. */
  workspaceRoot: string;
  createdAt: string;
  updatedAt: string;
  turns: Turn[];
  workingState: WorkingState;
  changeSet: Record<string, SessionChange>;
}
