import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { CheckpointEntry, Session, SessionChange, Turn, TurnChange, WorkingState } from "./types.js";

/**
 * Where a session lives, and how it is kept.
 *
 * One file per workspace, beside the memory store: `<app data>/comu/workspaces/<key>/session.json`,
 * the same tree memory writes `<key>/memory/` into. The key is a hash of the normalised workspace
 * root, so any process that knows the root (the runtime, the extension) finds the same file.
 *
 * Written after every turn, to a temporary file renamed over the real one, so a crash mid-write
 * leaves the previous session intact rather than half a file.
 */

/**
 * The cap on a session file, in bytes of JSON.
 *
 * One megabyte holds roughly a hundred ordinary turns with their diffs. Past it, the oldest turns
 * lose their full text first (message, answer, diffs); their metadata, the working state and the
 * change set are never dropped to make room.
 */
export const MAX_SESSION_BYTES = 1_000_000;

/** Per-turn bounds, applied when a turn is recorded, so one enormous answer cannot fill the cap alone. */
export const MAX_USER_MESSAGE_CHARS = 20_000;
export const MAX_FINAL_TEXT_CHARS = 50_000;
export const MAX_DIFF_CHARS_PER_FILE = 20_000;
const MAX_FILES_READ_PER_TURN = 50;
const MAX_WORKING_FILES_READ = 50;
const MAX_WORKING_VERIFICATION = 10;

export interface StoreOptions {
  /** Overrides the app data directory; tests and tools point this at a temporary directory. */
  baseDir?: string;
  /** Literal credential values to redact, in addition to the key shapes below. */
  secrets?: string[];
  /**
   * Never change the file, even to move a corrupt one aside. For a reader that is not the store's
   * writer: the runtime writes the session, the extension only reads it.
   */
  readOnly?: boolean;
}

export function defaultBaseDir(): string {
  const platform = os.platform();
  let appDataDir: string;
  if (platform === "win32") {
    appDataDir = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), "AppData", "Local");
  } else if (platform === "darwin") {
    appDataDir = path.join(os.homedir(), "Library", "Application Support");
  } else {
    appDataDir = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  }
  return path.join(appDataDir, "comu", "workspaces");
}

/** The root as the session is keyed by it: resolved, and case-folded where the file system is. */
export function normaliseRoot(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot);
  return os.platform() === "win32" ? resolved.toLowerCase() : resolved;
}

export function sessionFilePath(workspaceRoot: string, options: StoreOptions = {}): string {
  const key = crypto.createHash("sha256").update(normaliseRoot(workspaceRoot)).digest("hex").substring(0, 16);
  return path.join(options.baseDir ?? defaultBaseDir(), key, "session.json");
}

export function emptyWorkingState(): WorkingState {
  return { goal: "", filesRead: [], filesChanged: [], decisions: [], openQuestions: [], verification: [] };
}

export function newSession(workspaceRoot: string): Session {
  const now = new Date().toISOString();
  return {
    version: 1,
    sessionId: `session-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    workspaceRoot: normaliseRoot(workspaceRoot),
    createdAt: now,
    updatedAt: now,
    turns: [],
    workingState: emptyWorkingState(),
    changeSet: {}
  };
}

/**
 * The session for a workspace, or a new empty one.
 *
 * A file that belongs to a different root is never read into this one: its turns carry another
 * workspace's prompts and diffs. A file that does not parse is moved aside rather than deleted,
 * and the workspace starts a new session.
 */
export function loadSession(workspaceRoot: string, options: StoreOptions = {}): Session {
  const file = sessionFilePath(workspaceRoot, options);
  if (!fs.existsSync(file)) return newSession(workspaceRoot);

  let parsed: Session;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Session;
  } catch {
    if (!options.readOnly) fs.renameSync(file, `${file}.corrupt.${Date.now()}`);
    return newSession(workspaceRoot);
  }
  if (parsed.version !== 1 || parsed.workspaceRoot !== normaliseRoot(workspaceRoot)) return newSession(workspaceRoot);
  return parsed;
}

/**
 * Records a finished turn: reads the file as it is now, adds the turn, derives the working state,
 * bounds the result and writes it back.
 *
 * Read at write time rather than cached, so two tasks finishing in the same workspace cannot write
 * over each other's turn. Everything here is synchronous, so within one process the read, change
 * and write cannot interleave.
 */
export function appendTurn(workspaceRoot: string, turn: Turn, options: StoreOptions = {}): Session {
  const file = sessionFilePath(workspaceRoot, options);
  if (fs.existsSync(file)) {
    const owner = readOwner(file);
    // Never overwrite a session that belongs to another workspace, even on a hash collision.
    if (owner !== undefined && owner !== normaliseRoot(workspaceRoot)) {
      throw new Error(`The session file at ${file} belongs to another workspace; the turn was not recorded.`);
    }
  }

  const session = loadSession(workspaceRoot, options);
  const bounded = redactTurn(boundTurn(turn), options.secrets ?? []);
  const checkpoint = session.openCheckpoints?.[turn.taskId];
  if (checkpoint && checkpoint.length > 0) bounded.checkpoint = checkpoint;
  if (session.openCheckpoints) delete session.openCheckpoints[turn.taskId];
  session.turns.push(bounded);
  accumulateChanges(session, bounded);
  session.workingState = deriveWorkingState(session);
  session.updatedAt = bounded.endedAt;

  writeSession(file, enforceCap(session));
  return session;
}

/** Checkpoints of unfinished turns kept at most, so a run of crashes cannot grow the file without end. */
const MAX_OPEN_CHECKPOINT_TASKS = 20;

/**
 * Records a file as it was, before a running turn first changes it.
 *
 * Written to disk now, before the change, not when the turn ends: a turn that dies half way through
 * its changes is the case a checkpoint exists for. A second entry for the same file in the same
 * turn is ignored, since only the state before the turn's first change counts.
 */
export function recordCheckpoint(workspaceRoot: string, taskId: string, entry: CheckpointEntry, options: StoreOptions = {}): void {
  const file = sessionFilePath(workspaceRoot, options);
  if (fs.existsSync(file)) {
    const owner = readOwner(file);
    if (owner !== undefined && owner !== normaliseRoot(workspaceRoot)) {
      throw new Error(`The session file at ${file} belongs to another workspace; the checkpoint was not recorded.`);
    }
  }
  const session = loadSession(workspaceRoot, options);
  const open = (session.openCheckpoints ??= {});
  const entries = (open[taskId] ??= []);
  if (entries.some(e => e.path === entry.path)) return;
  entries.push(entry);

  const tasks = Object.keys(open);
  for (const stale of tasks.slice(0, Math.max(0, tasks.length - MAX_OPEN_CHECKPOINT_TASKS))) delete open[stale];
  writeSession(file, session);
}

function readOwner(file: string): string | undefined {
  try {
    return (JSON.parse(fs.readFileSync(file, "utf8")) as Session).workspaceRoot;
  } catch {
    return undefined;
  }
}

/**
 * Written with owner-only permissions, because a session carries prompts and diffs. On POSIX the
 * mode is what protects it. On Windows the mode bits only toggle read-only; the protection there
 * is the per-user ACL on the app data directory the file lives in.
 */
function writeSession(file: string, session: Session): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, file);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[... ${text.length - max} characters not kept]` : text;
}

function boundTurn(turn: Turn): Turn {
  return {
    ...turn,
    userMessage: clip(turn.userMessage, MAX_USER_MESSAGE_CHARS),
    finalText: clip(turn.finalText, MAX_FINAL_TEXT_CHARS),
    filesRead: turn.filesRead.slice(0, MAX_FILES_READ_PER_TURN),
    changes: turn.changes.map(change =>
      change.diff.length > MAX_DIFF_CHARS_PER_FILE
        ? { ...change, diff: change.diff.slice(0, MAX_DIFF_CHARS_PER_FILE), diffTruncated: true }
        : change
    )
  };
}

/**
 * Shapes a provider key or token takes. Only shapes: the generic "password=" and "*_KEY=" rules the
 * memory sanitizer also applies would rewrite ordinary code in a diff, and a diff is what an undo
 * is made from.
 */
const KEY_SHAPES: RegExp[] = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9_\-.]{16,}/g,
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9_-])nvapi-[A-Za-z0-9_-]{16,}/g,
  /(?<![A-Za-z0-9_-])exp-[A-Za-z0-9_-]{16,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g
];

/** Removes anything credential-shaped, and any credential the caller holds, from a piece of text. */
export function redactSecrets(text: string, secrets: string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join("[redacted credential]");
  }
  for (const shape of KEY_SHAPES) out = out.replace(shape, "[redacted credential]");
  return out;
}

function redactTurn(turn: Turn, secrets: string[]): Turn {
  const r = (text: string) => redactSecrets(text, secrets);
  return {
    ...turn,
    userMessage: r(turn.userMessage),
    finalText: r(turn.finalText),
    error: turn.error === undefined ? undefined : r(turn.error),
    verificationSummary: turn.verificationSummary === undefined ? undefined : r(turn.verificationSummary),
    changes: turn.changes.map(change => ({ ...change, diff: r(change.diff) }))
  };
}

function accumulateChanges(session: Session, turn: Turn): void {
  for (const change of turn.changes) {
    const existing: SessionChange | undefined = session.changeSet[change.path];
    if (existing) {
      existing.currentHash = change.newHash;
      existing.additions += change.additions;
      existing.deletions += change.deletions;
      if (!existing.taskIds.includes(turn.taskId)) existing.taskIds.push(turn.taskId);
    } else {
      session.changeSet[change.path] = {
        path: change.path,
        originalExisted: change.operation === "MODIFY",
        originalHash: change.originalHash,
        currentHash: change.newHash,
        taskIds: [turn.taskId],
        additions: change.additions,
        deletions: change.deletions
      };
    }
  }
}

/**
 * The working state, from the turns and the change set alone.
 *
 * Everything here is observed, not inferred. Decisions and open questions stay empty: nothing typed
 * produces them yet, and filling them from the model's prose is the mistake decision 0017 names.
 */
export function deriveWorkingState(session: Session): WorkingState {
  const turns = session.turns;
  const filesRead: string[] = [];
  for (const turn of [...turns].reverse()) {
    for (const file of turn.filesRead) {
      if (!filesRead.includes(file)) filesRead.push(file);
    }
  }

  const filesChanged = Object.values(session.changeSet).map(change => ({ path: change.path, summary: summariseChange(change) }));

  const verification = [...turns]
    .reverse()
    .filter(turn => turn.changes.length > 0 || turn.verification !== "NONE")
    .slice(0, MAX_WORKING_VERIFICATION)
    .map(turn => ({
      taskId: turn.taskId,
      status: turn.verification,
      files: turn.changes.map(c => c.path),
      ...(turn.verificationSummary ? { summary: turn.verificationSummary } : {})
    }));

  return {
    goal: turns.at(-1)?.userMessage ?? "",
    filesRead: filesRead.slice(0, MAX_WORKING_FILES_READ),
    filesChanged,
    decisions: [],
    openQuestions: [],
    verification
  };
}

function summariseChange(change: SessionChange): string {
  const verb = change.originalExisted ? "modified" : "created";
  const turns = change.taskIds.length === 1 ? "in 1 turn" : `across ${change.taskIds.length} turns`;
  const reverted = change.originalExisted && change.originalHash !== undefined && change.originalHash === change.currentHash;
  return reverted ? `${verb} ${turns}, now back to its original content` : `${verb} ${turns}, +${change.additions} -${change.deletions}`;
}

/**
 * Keeps the file under the cap by dropping the oldest turns' full text first.
 *
 * The working state and the change set are never touched: they are what the next turn is built
 * on. The newest turn keeps its text, since it is the one "undo that" or "why did that fail"
 * refers to. If stripping text is not enough, the oldest turns' records go too.
 */
function enforceCap(session: Session): Session {
  const size = () => Buffer.byteLength(JSON.stringify(session, null, 2), "utf8");
  for (let i = 0; i < session.turns.length - 1 && size() > MAX_SESSION_BYTES; i++) {
    const turn = session.turns[i];
    if (turn.textDropped) continue;
    session.turns[i] = {
      ...turn,
      userMessage: "",
      finalText: "",
      error: undefined,
      changes: turn.changes.map(change => ({ ...change, diff: "", diffTruncated: true })),
      textDropped: true
    };
  }
  while (session.turns.length > 1 && size() > MAX_SESSION_BYTES) session.turns.shift();
  return session;
}

/** Workspace-relative, forward-slashed: the key a change is recorded under. */
export function relativePath(workspaceRoot: string, filePath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
  return path.relative(workspaceRoot, absolute).split(path.sep).join("/");
}

export type { TurnChange };
