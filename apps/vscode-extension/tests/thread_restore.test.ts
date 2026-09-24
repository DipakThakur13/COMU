import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendTurn, loadSession, sessionFilePath, type Turn } from "@comu/session-store";
import { createInitialSessionState, restoreThread, restoredTurn, threadEntries } from "@comu/ui-state";

/**
 * The thread survives a restart: the runtime wrote the session file, the extension reads it back
 * into the panel. These are the calls the chat provider makes (loadSession read-only, restoredTurn,
 * restoreThread), from a real file, to the rows the panel renders.
 */

let baseDir: string;
let root: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-restore-base-"));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "comu-restore-root-"));
});
afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

const turn = (over: Partial<Turn>): Turn => ({
  turnId: "turn-x",
  taskId: "x",
  userMessage: "",
  status: "completed",
  finalText: "",
  changes: [],
  filesRead: [],
  tools: [],
  verification: "NONE",
  startedAt: "2026-09-24T10:00:00.000Z",
  endedAt: "2026-09-24T10:01:00.000Z",
  ...over
});

describe("restoring the thread from the session file", () => {
  it("puts every recorded turn back in the panel, in order, under what the user said", () => {
    appendTurn(root, turn({ turnId: "turn-a", taskId: "a", userMessage: "give me a button", mode: "ASK", finalText: "<button>Buy</button>" }), { baseDir });
    appendTurn(
      root,
      turn({
        turnId: "turn-b",
        taskId: "b",
        userMessage: "put it in src/buy.html",
        mode: "AGENT",
        finalText: "Created src/buy.html.",
        changes: [{ path: "src/buy.html", operation: "CREATE", additions: 1, deletions: 0, diff: "+<button>Buy</button>\n", diffTruncated: false }],
        verification: "NOT_VERIFIED"
      }),
      { baseDir }
    );

    const session = loadSession(root, { baseDir, readOnly: true });
    const state = restoreThread(createInitialSessionState(), session.turns.map(restoredTurn));
    const rows = threadEntries(state).map(r => ("title" in r ? `${r.category}:${r.title}` : r.id));

    expect(rows).toEqual([
      "USER_MESSAGE:give me a button",
      "AGENT_MESSAGE:Assistant",
      "USER_MESSAGE:put it in src/buy.html",
      "TOOL_ACTIVITY:Created buy.html",
      "VALIDATION:Not verified",
      "AGENT_MESSAGE:Assistant"
    ]);
  });

  it("reads without writing: a corrupt file is left where it is for the runtime to deal with", () => {
    const file = sessionFilePath(root, { baseDir });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json", "utf8");
    expect(loadSession(root, { baseDir, readOnly: true }).turns).toEqual([]);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["session.json"]);
  });
});
