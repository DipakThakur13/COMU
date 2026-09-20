import { describe, it, expect, vi } from "vitest";
import { ApprovalGate } from "../../src/approval/approval_gate.js";
import { InteractionManager } from "../../src/interaction_manager.js";
import { ComuDiffEngine } from "@comu/diff-engine";

const diffEngine = new ComuDiffEngine();

function gate(overrides: Partial<ConstructorParameters<typeof ApprovalGate>[0]> = {}) {
  const events: any[] = [];
  const g = new ApprovalGate({
    taskId: "t1",
    autonomy: "ask",
    workspaceRoot: "/repo",
    onEvent: e => events.push(e),
    timeoutMs: 1000,
    createUnifiedDiff: (p, a, b) => diffEngine.createUnifiedDiff(p, a, b),
    ...overrides
  });
  return { g, events };
}

describe("ApprovalGate: when approval is required", () => {
  const write = { name: "write_file", capabilities: ["write"] as const };
  const read = { name: "read_file", capabilities: ["read"] as const };
  const exec = { name: "execute_command", capabilities: ["execute"] as const };
  const push = { name: "git_push", capabilities: ["execute"] as const, requiresApproval: "always" as const };

  it("ask: write and execute need approval, read does not", () => {
    const { g } = gate();
    expect(g.requiresApproval(write as any)).toBe(true);
    expect(g.requiresApproval(exec as any)).toBe(true);
    expect(g.requiresApproval(read as any)).toBe(false);
  });

  it("auto: nothing needs approval except requiresApproval: always", () => {
    const { g } = gate({ autonomy: "auto" });
    expect(g.requiresApproval(write as any)).toBe(false);
    expect(g.requiresApproval(exec as any)).toBe(false);
    expect(g.requiresApproval(push as any)).toBe(true);
  });

  it("readonly: the contract already forbids mutation; the gate stays out of the way", () => {
    const { g } = gate({ autonomy: "readonly" });
    expect(g.requiresApproval(write as any)).toBe(false);
    expect(g.requiresApproval(push as any)).toBe(true);
  });
});

describe("ApprovalGate: scope keys", () => {
  it("file scopes are explicit breadths with distinct keys and labels", () => {
    const { g } = gate();
    const payload = g.buildPayload({ name: "write_file", capabilities: ["write"] }, { path: "src/auth/login.ts", content: "x" }, { exists: false });
    expect(payload.scopes.map(s => s.key)).toEqual(["file:src/auth/login.ts", "dir:src/auth/", "writes:*"]);
    expect(payload.scopes.map(s => s.label)).toEqual([
      "Approve writes to src/auth/login.ts for this session",
      "Approve writes under src/auth/ for this session",
      "Approve all writes for this session"
    ]);
    expect(ApprovalGate.matchingKeys(payload)).toEqual(["file:src/auth/login.ts", "dir:src/auth/", "dir:src/", "dir:/", "writes:*"]);
  });

  it("a root-level file offers no directory scope", () => {
    const { g } = gate();
    const payload = g.buildPayload({ name: "create_file", capabilities: ["write"] }, { path: "README.md", content: "x" }, { exists: false });
    expect(payload.scopes.map(s => s.key)).toEqual(["file:README.md", "writes:*"]);
  });

  it("directory grants cover files beneath them but not siblings; file grants cover only that file", () => {
    const { g } = gate();
    const a = g.buildPayload({ name: "write_file", capabilities: ["write"] }, { path: "src/auth/login.ts", content: "x" }, { exists: false });
    const b = g.buildPayload({ name: "write_file", capabilities: ["write"] }, { path: "src/auth/session.ts", content: "x" }, { exists: false });
    const c = g.buildPayload({ name: "write_file", capabilities: ["write"] }, { path: "src/billing/invoice.ts", content: "x" }, { exists: false });
    g.grant("file:src/auth/login.ts");
    expect(g.findGrant(a)).toBe("file:src/auth/login.ts");
    expect(g.findGrant(b)).toBeUndefined();
    g.grant("dir:src/auth/");
    expect(g.findGrant(b)).toBe("dir:src/auth/");
    expect(g.findGrant(c)).toBeUndefined();
    g.grant("writes:*");
    expect(g.findGrant(c)).toBe("writes:*");
  });

  it("command keys use the full normalised argument vector, so subcommands never collapse", () => {
    expect(ApprovalGate.commandKey("npm", ["run", "build"])).toBe("cmd:npm run build");
    expect(ApprovalGate.commandKey("npm", ["run", "deploy"])).toBe("cmd:npm run deploy");
    expect(ApprovalGate.commandKey("NPM", [" run ", "build"])).toBe("cmd:npm run build");
    expect(ApprovalGate.commandKey("/usr/bin/npm", ["test"])).toBe("cmd:npm test");
    expect(ApprovalGate.commandKey("npm", ["run", "build"])).not.toBe(ApprovalGate.commandKey("npm", ["run", "build", "--watch"]));
    const long = ApprovalGate.commandKey("pytest", ["tests", "-k", "auth", "-x", "-q", "--maxfail=1", "--tb=short", "-p", "no:cacheprovider"]);
    expect(long).toBe("cmd:pytest tests -k (+7 more args)");
    expect(long).not.toBe(ApprovalGate.commandKey("pytest", ["tests", "-m", "slow", "-x", "-q", "--maxfail=1", "--tb=short", "-p", "no:cacheprovider"]));
  });

  it("git push is never grantable for a session", () => {
    const { g } = gate({ autonomy: "auto" });
    const payload = g.buildPayload({ name: "git_push", capabilities: ["execute"], requiresApproval: "always" }, { remote: "origin", branch: "main" });
    expect(payload.kind).toBe("git_push");
    expect(payload.scopes).toEqual([]);
    expect(ApprovalGate.matchingKeys(payload)).toEqual([]);
  });
});

describe("ApprovalGate: reviewable payloads", () => {
  it("write_file carries a unified diff against the baseline with counts and CREATE/MODIFY", () => {
    const { g } = gate();
    const modify = g.buildPayload(
      { name: "write_file", capabilities: ["write"] },
      { path: "src/a.ts", content: "line1\nline2 changed\nline3\n" },
      { exists: true, content: "line1\nline2\nline3\n" }
    );
    expect(modify.kind).toBe("file_write");
    expect(modify.file?.operation).toBe("MODIFY");
    expect(modify.file?.diff).toContain("-line2");
    expect(modify.file?.diff).toContain("+line2 changed");
    expect(modify.file?.additions).toBe(1);
    expect(modify.file?.deletions).toBe(1);
    expect(modify.summary).toBe("Modify src/a.ts (+1 -1)");

    const create = g.buildPayload({ name: "create_file", capabilities: ["write"] }, { path: "new.ts", content: "a\nb\n" }, { exists: false });
    expect(create.file?.operation).toBe("CREATE");
    expect(create.file?.additions).toBe(2);
    expect(create.file?.deletions).toBe(0);
  });

  it("edit_file applies the edits in memory so the diff is what will land, and flags failing edits", () => {
    const { g } = gate();
    const ok = g.buildPayload(
      { name: "edit_file", capabilities: ["write"] },
      { path: "src/a.ts", edits: [{ oldText: "const x = 1;", newText: "const x = 2;" }] },
      { exists: true, content: "const x = 1;\nexport { x };\n" }
    );
    expect(ok.kind).toBe("file_edit");
    expect(ok.file?.diff).toContain("+const x = 2;");
    expect(ok.file?.note).toBeUndefined();

    const bad = g.buildPayload(
      { name: "edit_file", capabilities: ["write"] },
      { path: "src/a.ts", edits: [{ oldText: "missing", newText: "y" }] },
      { exists: true, content: "const x = 1;\n" }
    );
    expect(bad.file?.note).toContain("not found");
    expect(bad.file?.additions).toBe(0);
  });

  it("execute_command carries the exact executable, argv and resolved cwd, never a shell string", () => {
    const { g } = gate();
    const payload = g.buildPayload({ name: "execute_command", capabilities: ["execute"] }, { executable: "npm", args: ["run", "build"], cwd: "packages/app" });
    expect(payload.kind).toBe("command");
    expect(payload.command?.executable).toBe("npm");
    expect(payload.command?.args).toEqual(["run", "build"]);
    expect(payload.command?.cwd.replace(/\\/g, "/")).toMatch(/\/repo\/packages\/app$/);
    expect(payload.scopes).toEqual([{ key: "cmd:npm run build", label: "Approve this exact command for this session" }]);
  });

  it("truncates very large diffs and says so", () => {
    const { g } = gate();
    const big = Array.from({ length: 3000 }, (_, i) => `line ${i} ${"x".repeat(20)}`).join("\n");
    const payload = g.buildPayload({ name: "write_file", capabilities: ["write"] }, { path: "big.txt", content: big }, { exists: false });
    expect(payload.file?.truncated).toBe(true);
    expect(payload.file?.diff.length).toBeLessThan(21_000);
  });
});

describe("ApprovalGate: decisions and the no-human case", () => {
  const writeTool = { name: "write_file", capabilities: ["write"] as any };

  it("denies immediately when no human is observing, without raising an interaction", async () => {
    const im = new InteractionManager(1000);
    const { g, events } = gate({ interactionManager: im, hasHumanObserver: () => false, observerGraceMs: 0 });
    const decision = await g.decide(g.buildPayload(writeTool, { path: "a.ts", content: "x" }, { exists: false }));
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe("NO_HUMAN_OBSERVER");
    expect(im.getPendingInteraction("t1")).toBeUndefined();
    expect(events.find(e => e.type === "approval.decided")).toMatchObject({ approved: false, decision: "NO_HUMAN_OBSERVER", tool: "write_file", path: "a.ts" });
  });

  it("waits for an observer to attach within the grace period before deciding headless", async () => {
    const im = new InteractionManager(5000);
    let attached = false;
    setTimeout(() => { attached = true; }, 60);
    const { g } = gate({ interactionManager: im, hasHumanObserver: () => attached, observerGraceMs: 500 });
    const pending = g.decide(g.buildPayload(writeTool, { path: "a.ts", content: "x" }, { exists: false }));
    // an interaction appears once the observer is there
    let interaction;
    for (let i = 0; i < 40 && !interaction; i++) {
      await new Promise(r => setTimeout(r, 10));
      interaction = im.getPendingInteraction("t1");
    }
    expect(interaction).toBeDefined();
    im.resolveInteraction("t1", interaction!.interactionId, { type: "APPROVE" });
    expect((await pending).reason).toBe("APPROVED");

    const never = gate({ interactionManager: im, hasHumanObserver: () => false, observerGraceMs: 80 });
    const started = Date.now();
    const denied = await never.g.decide(never.g.buildPayload(writeTool, { path: "b.ts", content: "x" }, { exists: false }));
    expect(denied.reason).toBe("NO_HUMAN_OBSERVER");
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
  });

  it("denies after the bounded wait and records TIMEOUT", async () => {
    const im = new InteractionManager(5000);
    const { g, events } = gate({ interactionManager: im, timeoutMs: 40 });
    const decision = await g.decide(g.buildPayload(writeTool, { path: "a.ts", content: "x" }, { exists: false }));
    expect(decision).toMatchObject({ approved: false, reason: "TIMEOUT" });
    expect(events.find(e => e.type === "approval.decided")?.decision).toBe("TIMEOUT");
    expect(events.some(e => e.type === "interaction.expired")).toBe(true);
  });

  it("denies when no interaction channel exists", async () => {
    const { g } = gate({ interactionManager: undefined });
    const decision = await g.decide(g.buildPayload(writeTool, { path: "a.ts", content: "x" }, { exists: false }));
    expect(decision.reason).toBe("NO_INTERACTION_CHANNEL");
  });

  it("approve-for-session stores only an offered scope key and journals it", async () => {
    const im = new InteractionManager(5000);
    const { g, events } = gate({ interactionManager: im });
    const payload = g.buildPayload(writeTool, { path: "src/a.ts", content: "x" }, { exists: false });
    const pending = g.decide(payload);
    await new Promise(r => setTimeout(r, 5));
    const interaction = im.getPendingInteraction("t1")!;
    expect(interaction.approval?.file?.path).toBe("src/a.ts");
    expect(interaction.approval?.scopes.map(s => s.key)).toContain("dir:src/");
    im.resolveInteraction("t1", interaction.interactionId, { type: "APPROVE_SESSION", scopeKey: "dir:src/" });
    const decision = await pending;
    expect(decision).toMatchObject({ approved: true, reason: "APPROVED_SESSION", scopeKey: "dir:src/" });
    expect(g.listGrants()).toEqual(["dir:src/"]);
    expect(events.find(e => e.type === "approval.decided")).toMatchObject({ decision: "APPROVED_SESSION", scopeKey: "dir:src/" });

    // an unknown scope key approves once but grants nothing
    const p2 = g.decide(g.buildPayload({ name: "execute_command", capabilities: ["execute"] }, { executable: "npm", args: ["test"] }));
    await new Promise(r => setTimeout(r, 5));
    const i2 = im.getPendingInteraction("t1")!;
    im.resolveInteraction("t1", i2.interactionId, { type: "APPROVE_SESSION", scopeKey: "writes:*" });
    expect((await p2).reason).toBe("APPROVED");
    expect(g.listGrants()).toEqual(["dir:src/"]);
  });

  it("a session grant short-circuits later calls and is journaled as SESSION_GRANT", async () => {
    const im = new InteractionManager(5000);
    const { g, events } = gate({ interactionManager: im });
    g.grant("cmd:npm run build");
    const covered = await g.decide(g.buildPayload({ name: "execute_command", capabilities: ["execute"] }, { executable: "npm", args: ["run", "build"] }));
    expect(covered).toMatchObject({ approved: true, reason: "SESSION_GRANT", scopeKey: "cmd:npm run build" });
    expect(im.getPendingInteraction("t1")).toBeUndefined();
    expect(events[0]).toMatchObject({ type: "approval.decided", decision: "SESSION_GRANT", command: { executable: "npm", args: ["run", "build"] } });
  });

  it("rejects when the task is cancelled while waiting", async () => {
    const im = new InteractionManager(5000);
    const controller = new AbortController();
    const { g } = gate({ interactionManager: im, abortSignal: controller.signal });
    const pending = g.decide(g.buildPayload(writeTool, { path: "a.ts", content: "x" }, { exists: false }));
    await new Promise(r => setTimeout(r, 5));
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/i);
    expect(im.getPendingInteraction("t1")).toBeUndefined();
  });
});
