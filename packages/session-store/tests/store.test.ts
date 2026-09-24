import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_SESSION_BYTES,
  RECENT_HISTORY_CHAR_BUDGET,
  appendTurn,
  buildTurnContext,
  loadSession,
  sessionFilePath,
  type Turn
} from "../src/index.js";

let baseDir: string;
let root: string;

const turn = (over: Partial<Turn> = {}): Turn => ({
  turnId: `turn-${Math.random().toString(36).slice(2)}`,
  taskId: `task-${Math.random().toString(36).slice(2)}`,
  userMessage: "do the thing",
  mode: "AGENT",
  status: "completed",
  finalText: "Done.",
  changes: [],
  filesRead: [],
  tools: [],
  verification: "NONE",
  startedAt: "2026-09-24T10:00:00.000Z",
  endedAt: "2026-09-24T10:01:00.000Z",
  ...over
});

const change = (p: string, over: Record<string, unknown> = {}) => ({
  path: p,
  operation: "MODIFY" as const,
  originalHash: "aaa",
  newHash: "bbb",
  additions: 1,
  deletions: 1,
  diff: `--- ${p}\n+++ ${p}\n-old\n+new\n`,
  diffTruncated: false,
  ...over
});

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-session-base-"));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "comu-session-root-"));
});
afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

describe("the session store", () => {
  it("persists every turn, and a restart reads the thread back", () => {
    appendTurn(root, turn({ userMessage: "first" }), { baseDir });
    appendTurn(root, turn({ userMessage: "second" }), { baseDir });
    const loaded = loadSession(root, { baseDir });
    expect(loaded.turns.map(t => t.userMessage)).toEqual(["first", "second"]);
    expect(loaded.workingState.goal).toBe("second");
  });

  it("writes by renaming a complete file into place, leaving no temporary file behind", () => {
    appendTurn(root, turn(), { baseDir });
    const dir = path.dirname(sessionFilePath(root, { baseDir }));
    expect(fs.readdirSync(dir)).toEqual(["session.json"]);
  });

  it("keeps a session to its own workspace", () => {
    appendTurn(root, turn({ userMessage: "private to root" }), { baseDir });
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "comu-session-other-"));
    try {
      expect(loadSession(other, { baseDir }).turns).toEqual([]);
      // A file whose recorded owner is another root is never read into this one, and never overwritten.
      const file = sessionFilePath(other, { baseDir });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(sessionFilePath(root, { baseDir }), file);
      expect(loadSession(other, { baseDir }).turns).toEqual([]);
      expect(() => appendTurn(other, turn(), { baseDir })).toThrow(/belongs to another workspace/);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it("moves a corrupt file aside and starts again, rather than failing the turn", () => {
    const file = sessionFilePath(root, { baseDir });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json", "utf8");
    expect(loadSession(root, { baseDir }).turns).toEqual([]);
    expect(fs.readdirSync(path.dirname(file)).some(f => f.startsWith("session.json.corrupt."))).toBe(true);
  });

  it("never writes a credential, by shape or by the value the caller holds", () => {
    const held = "held-secret-value-123456";
    appendTurn(
      root,
      turn({
        userMessage: "use nvapi-ABCDEFGHIJKLMNOPQRSTUV and sk-abcdefghijklmnopqrstuvwxyz",
        finalText: `the key is ${held}`,
        changes: [change("src/a.ts", { diff: "+const token = 'Bearer abcdefghijklmnopqrstu';\n" })]
      }),
      { baseDir, secrets: [held] }
    );
    const text = fs.readFileSync(sessionFilePath(root, { baseDir }), "utf8");
    expect(text).not.toContain("nvapi-ABCDEFGHIJ");
    expect(text).not.toContain("sk-abcdefghij");
    expect(text).not.toContain(held);
    expect(text).not.toContain("Bearer abcdefghij");
    expect(text).toContain("[redacted credential]");
  });

  it("accumulates the change set across turns, and knows when a file is back where it started", () => {
    appendTurn(root, turn({ taskId: "t1", changes: [change("src/a.ts", { originalHash: "h0", newHash: "h1" })] }), { baseDir });
    appendTurn(root, turn({ taskId: "t2", changes: [change("src/a.ts", { originalHash: "h1", newHash: "h0" })] }), { baseDir });
    const session = loadSession(root, { baseDir });
    expect(session.changeSet["src/a.ts"]).toMatchObject({ originalHash: "h0", currentHash: "h0", taskIds: ["t1", "t2"] });
    expect(session.workingState.filesChanged).toEqual([{ path: "src/a.ts", summary: "modified across 2 turns, now back to its original content" }]);
  });

  it("drops the oldest turns' text first past the cap, never the working state or the change set", () => {
    const big = "x".repeat(40_000);
    for (let i = 0; i < 40; i++) {
      appendTurn(root, turn({ taskId: `t${i}`, finalText: big, changes: [change(`src/f${i}.ts`)] }), { baseDir });
    }
    const file = sessionFilePath(root, { baseDir });
    expect(fs.statSync(file).size).toBeLessThanOrEqual(MAX_SESSION_BYTES);
    const session = loadSession(root, { baseDir });
    expect(session.turns[0].textDropped).toBe(true);
    expect(session.turns.at(-1)?.finalText).toBe(big);
    expect(Object.keys(session.changeSet)).toHaveLength(40);
    expect(session.workingState.filesChanged).toHaveLength(40);
  });
});

describe("the turn context", () => {
  it("is absent for a session with no turns, so a first turn is built exactly as before", () => {
    expect(buildTurnContext(loadSession(root, { baseDir }))).toBeUndefined();
  });

  it("carries earlier turns as messages, newest kept, oldest dropped past the budget", () => {
    const long = "y".repeat(RECENT_HISTORY_CHAR_BUDGET / 3);
    for (let i = 0; i < 5; i++) appendTurn(root, turn({ userMessage: `q${i}`, finalText: long }), { baseDir });
    const context = buildTurnContext(loadSession(root, { baseDir }))!;
    const users = context.history.filter(m => m.role === "user").map(m => m.content);
    expect(users.at(-1)).toBe("q4");
    expect(users).not.toContain("q0");
    expect(context.history.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(RECENT_HISTORY_CHAR_BUDGET);
  });

  it("gives a failed turn to the next one as what happened, with the agent's own words", () => {
    appendTurn(root, turn({ status: "failed", error: "Verification could not run", finalText: "I changed src/a.ts." }), { baseDir });
    const context = buildTurnContext(loadSession(root, { baseDir }))!;
    expect(context.history[1].content).toContain("This turn failed: Verification could not run");
    expect(context.history[1].content).toContain("I changed src/a.ts.");
  });

  it("names the most recent change with its diff, for undo", () => {
    appendTurn(root, turn({ userMessage: "edit a", changes: [change("src/a.ts")] }), { baseDir });
    appendTurn(root, turn({ userMessage: "what did you do?", mode: "ASK" }), { baseDir });
    const context = buildTurnContext(loadSession(root, { baseDir }))!;
    expect(context.lastChange).toMatchObject({ userMessage: "edit a", files: [{ path: "src/a.ts" }] });
    expect(context.lastChange?.files[0].diff).toContain("+new");
    expect(context.previousTurn).toMatchObject({ mode: "ASK", changedFiles: 0 });
  });
});
