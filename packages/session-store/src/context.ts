import type { Session, TurnVerification, WorkingState } from "./types.js";

/**
 * How much earlier conversation a turn carries, in characters of message text.
 *
 * There is no token budget yet; that is Stage 2, and it replaces this one constant. 24,000
 * characters is about 6,000 tokens: several ordinary exchanges, under five percent of a 128k window.
 * Whole turns are kept, newest first, and the oldest are dropped when the next would not fit.
 */
export const RECENT_HISTORY_CHAR_BUDGET = 24_000;

/** How much of the most recent change's diff goes into the prompt, so "undo that" can be acted on. */
export const LAST_CHANGE_DIFF_CHAR_BUDGET = 12_000;

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** The most recent turn that changed files, with what it changed. */
export interface LastChange {
  taskId: string;
  userMessage: string;
  files: Array<{ path: string; operation: "CREATE" | "MODIFY"; diff: string }>;
  /** Set when the diffs did not all fit in LAST_CHANGE_DIFF_CHAR_BUDGET. */
  diffOmitted: boolean;
}

/** Everything a turn is built from beyond its own prompt. */
export interface TurnContext {
  sessionId: string;
  /** Always included, never evicted. */
  workingState: WorkingState;
  /** Earlier turns as real messages, oldest first. */
  history: HistoryMessage[];
  lastChange?: LastChange;
  /** The turn before this one, for routing a follow-up. */
  previousTurn: { mode?: string; changedFiles: number; verification: TurnVerification };
}

/**
 * What the next turn in this session is built from, or undefined for a session with no turns yet.
 *
 * Undefined rather than an empty context on purpose: the first turn of a session builds exactly the
 * prompt a single task built before sessions existed, so a one-prompt run such as a benchmark cell
 * measures the same thing it did.
 */
export function buildTurnContext(session: Session, historyBudget = RECENT_HISTORY_CHAR_BUDGET): TurnContext | undefined {
  const last = session.turns.at(-1);
  if (!last) return undefined;

  const history: HistoryMessage[] = [];
  let used = 0;
  for (const turn of [...session.turns].reverse()) {
    if (turn.textDropped) break;
    const answer =
      turn.status === "completed"
        ? turn.finalText
        : [`(This turn ${turn.status === "failed" ? "failed" : "was cancelled"}${turn.error ? `: ${turn.error}` : ""}.)`, turn.finalText]
            .filter(Boolean)
            .join("\n\n");
    const pair: HistoryMessage[] = [
      { role: "user", content: turn.userMessage },
      { role: "assistant", content: answer || "(No answer was given.)" }
    ];
    const size = pair[0].content.length + pair[1].content.length;
    if (history.length > 0 && used + size > historyBudget) break;
    if (history.length === 0 && size > historyBudget) {
      // The newest turn alone is over budget: keep the end of its answer, where the result usually is.
      pair[1] = { role: "assistant", content: `[... earlier part of this answer not included]\n${pair[1].content.slice(-(historyBudget - Math.min(pair[0].content.length, historyBudget / 2)))}` };
      pair[0] = { role: "user", content: pair[0].content.slice(0, historyBudget / 2) };
    }
    history.unshift(...pair);
    used += size;
  }

  return {
    sessionId: session.sessionId,
    workingState: session.workingState,
    history,
    lastChange: lastChangeOf(session),
    previousTurn: { mode: last.mode, changedFiles: last.changes.length, verification: last.verification }
  };
}

function lastChangeOf(session: Session): LastChange | undefined {
  const turn = [...session.turns].reverse().find(t => t.changes.length > 0 && !t.textDropped);
  if (!turn) return undefined;
  let remaining = LAST_CHANGE_DIFF_CHAR_BUDGET;
  let diffOmitted = false;
  const files = turn.changes.map(change => {
    const fits = change.diff.length <= remaining;
    if (!fits || change.diffTruncated) diffOmitted = true;
    const diff = fits ? change.diff : "";
    remaining -= diff.length;
    return { path: change.path, operation: change.operation, diff };
  });
  return { taskId: turn.taskId, userMessage: turn.userMessage, files, diffOmitted };
}
