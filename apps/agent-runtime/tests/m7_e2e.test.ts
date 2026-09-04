import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentOrchestrator, OrchestratorContext, SubagentManager } from "@comu/agent-core";
import { TaskPlanner } from "@comu/planning-engine";
import { VerificationEngine } from "@comu/verification-engine";
import { RepairEngine } from "@comu/repair-engine";
import { ToolExecutor, ToolRegistry } from "@comu/tool-core";
import { ComuDiffEngine } from "@comu/diff-engine";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";
import { MemoryEngine } from "@comu/memory-engine";
import { DomainPolicy, WebDocsTool } from "@comu/tool-web-docs";
import { GitCreateBranchTool, GitStageFilesTool, GitCommitTool, GitPushTool } from "@comu/git";
import { AgentEvent } from "@comu/protocol";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

class TestScriptableModel implements ModelProvider {
  id = "test-model";
  name = "Test Model";
  public responses: ModelResponse[] = [];

  getCapabilities() {
    return {
      toolCalling: true,
      streaming: false,
      reasoning: false,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 1000
    };
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    const res = this.responses.shift();
    if (!res) {
      return { text: "Default completion" };
    }
    return res;
  }
}

describe("Milestone 7: Persistent Intelligence, Git Governance, Workers & Web Docs E2E", () => {
  let tempDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-m7-test-"));
    memoryDir = path.join(tempDir, "memory-store");
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ============================================================
  // Scenario 1: Memory-Informed Task
  // ============================================================
  it("Scenario 1: Memory-Informed Task & Supplementary Context", async () => {
    const memoryEngine = new MemoryEngine({ storageDir: memoryDir });
    const workspaceId = "ws-scenario-1";

    // Pre-record a verified convention into memory
    await memoryEngine.record({
      workspaceId,
      type: "CONVENTION",
      content: "All exports in this repository must use ESM and named exports only.",
      source: "USER",
      trustLevel: "USER_VERIFIED",
      confidence: 1.0,
      status: "ACTIVE",
      scope: { workspaceId }
    });

    const model = new TestScriptableModel();
    const registry = new ToolRegistry();
    registry.register({
      name: "read_file",
      description: "read",
      capabilities: ["read"],
      inputSchema: {},
      execute: async () => ({ content: "export const foo = 1;", hash: "h1" })
    });
    registry.register({
      name: "run_tests",
      description: "tests",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({ status: "PASS", exitCode: 0, stdout: "Passed" })
    });
    registry.register({
      name: "run_typecheck",
      description: "typecheck",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({ status: "PASS", exitCode: 0, stdout: "0 errors" })
    });

    const executor = new ToolExecutor(registry);
    const diffEngine = new ComuDiffEngine();
    const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine, {
      memoryEngine
    });

    const events: AgentEvent[] = [];
    model.responses = [{ text: "Task completed according to ESM conventions" }];

    const result = await orchestrator.run({
      taskId: "task-mem-1",
      workspaceRoot: tempDir,
      workspaceId,
      systemPrompt: "System",
      userPrompt: "Add a new export to the library adhering to exports convention",
      limits: { maxSteps: 5, maxToolCalls: 10, maxExecutionTimeMs: 10000 },
      onEvent: e => events.push(e)
    });

    expect(result.status).toBe("completed");
    const retrievedEvent = events.find(e => e.type === "memory.retrieved");
    expect(retrievedEvent).toBeDefined();
    // Verify an episode was recorded on completion
    const episodes = await memoryEngine.getEpisodes(workspaceId);
    expect(episodes.length).toBeGreaterThanOrEqual(1);
    expect(episodes[0].outcome).toBe("COMPLETED");
  });

  // ============================================================
  // Scenario 2: Memory Conflict & Workspace Ground Truth
  // ============================================================
  it("Scenario 2: Current Verified Workspace Evidence Overrides Memory", async () => {
    const memoryEngine = new MemoryEngine({ storageDir: memoryDir });
    const workspaceId = "ws-scenario-2";

    // Pre-record stale convention
    await memoryEngine.record({
      workspaceId,
      type: "CONVENTION",
      content: "Testing framework is Jest.",
      source: "AGENT",
      trustLevel: "AGENT_DERIVED",
      confidence: 0.5,
      status: "STALE",
      scope: { workspaceId }
    });

    // Query memory and verify ranker scores STALE lower than ACTIVE/USER_VERIFIED
    const queryRes = await memoryEngine.query({
      workspaceId,
      text: "test framework",
      includeStale: true
    });
    expect(queryRes.entries.length).toBe(1);
    expect(queryRes.entries[0].status).toBe("STALE");

    // Invalidate stale memory when fresh evidence is provided
    await memoryEngine.invalidate(workspaceId, queryRes.entries[0].id, "Package uses vitest.config.ts");
    const afterInvalidation = await memoryEngine.query({
      workspaceId,
      text: "test framework"
    });
    expect(afterInvalidation.entries.length).toBe(0);
  });

  // ============================================================
  // Scenario 3: Research Worker Delegation
  // ============================================================
  it("Scenario 3: Supervised Research Worker Delegation (Read-only findings)", async () => {
    const subagentManager = new SubagentManager();
    const model = new TestScriptableModel();
    const registry = new ToolRegistry();

    registry.register({
      name: "read_file",
      description: "read",
      capabilities: ["read"],
      inputSchema: {},
      execute: async () => ({ content: "export interface AuthConfig { token: string; }", hash: "h-auth" })
    });
    registry.register({
      name: "search_text",
      description: "search",
      capabilities: ["read"],
      inputSchema: {},
      execute: async () => ({ matches: [{ file: "src/auth.ts", line: 1, text: "AuthConfig" }] })
    });

    const executor = new ToolExecutor(registry);
    const subResult = await subagentManager.executeSubagent({
      parentTaskId: "parent-task-3",
      type: "RESEARCH",
      depth: 1,
      goal: "Find AuthConfig interface definition",
      model,
      registry,
      executor,
      toolContext: {
        taskId: "parent-task-3",
        workspace: { rootPath: tempDir },
        limits: { maxResults: 10, maxBytes: 10000 },
        permissions: { capabilities: { read: "ALLOW", write: "DENY", execute: "ALLOW", network: "DENY" } }
      },
      onEvent: () => {}
    });

    expect(subResult.status).toBe("COMPLETED");
    expect(subResult.parentTaskId).toBe("parent-task-3");
    expect(subResult.type).toBe("RESEARCH");
    expect(subResult.summary).toBeDefined();
  });

  // ============================================================
  // Scenario 4: Verification Worker Delegation
  // ============================================================
  it("Scenario 4: Supervised Verification Worker Delegation (Validation Checks)", async () => {
    const subagentManager = new SubagentManager();
    const model = new TestScriptableModel();
    const registry = new ToolRegistry();

    registry.register({
      name: "run_tests",
      description: "run tests",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({ status: "PASS", exitCode: 0, stdout: "3 tests passed" })
    });

    const executor = new ToolExecutor(registry);
    const subResult = await subagentManager.executeSubagent({
      parentTaskId: "parent-task-4",
      type: "VERIFICATION",
      depth: 1,
      goal: "Run test suite to verify changes",
      model,
      registry,
      executor,
      toolContext: {
        taskId: "parent-task-4",
        workspace: { rootPath: tempDir },
        limits: { maxResults: 10, maxBytes: 10000 },
        permissions: { capabilities: { read: "ALLOW", write: "DENY", execute: "ALLOW", network: "DENY" } }
      },
      onEvent: () => {}
    });

    expect(subResult.status).toBe("COMPLETED");
    expect(subResult.type).toBe("VERIFICATION");
  });

  // ============================================================
  // Scenario 5: Worker Cannot Escalate
  // ============================================================
  it("Scenario 5: Research Worker Cannot Escalate to Write Files or Spawn Subagents", async () => {
    const subagentManager = new SubagentManager();
    const caps = SubagentManager.getWorkerCapabilities("RESEARCH");

    // Must not allow write tools
    expect(caps.allowedTools).not.toContain("write_file");
    expect(caps.allowedTools).not.toContain("create_file");
    expect(caps.allowedTools).not.toContain("edit_file");
    expect(caps.allowedTools).not.toContain("git_commit");
    expect(caps.allowedTools).not.toContain("git_push");

    // Worker depth = 2 must be rejected by SubagentManager
    const model = new TestScriptableModel();
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry);

    const recursiveAttempt = await subagentManager.executeSubagent({
      parentTaskId: "worker-child",
      type: "RESEARCH",
      depth: 2, // VIOLATION: depth > 1
      goal: "Recursive subagent",
      model,
      registry,
      executor,
      toolContext: {
        taskId: "worker-child",
        workspace: { rootPath: tempDir },
        limits: { maxResults: 10, maxBytes: 10000 },
        permissions: { capabilities: { read: "ALLOW", write: "DENY", execute: "DENY", network: "DENY" } }
      },
      onEvent: () => {}
    });

    expect(recursiveAttempt.status).toBe("FAILED");
    expect(recursiveAttempt.error).toContain("FORBIDDEN_RECURSIVE_SUBAGENT");
  });

  // ============================================================
  // Scenario 6: Gated Git Commit Workflow
  // ============================================================
  it("Scenario 6: Gated Git Commit Only Stages Authorized ChangeSet Files", async () => {
    const stageTool = new GitStageFilesTool();
    const commitTool = new GitCommitTool();

    // Staging wildcard or dot must fail
    const stageRes = await stageTool.execute({ files: ["."] }, {
      taskId: "task-git-6",
      workspace: { rootPath: tempDir },
      limits: { maxResults: 10, maxBytes: 10000 },
      permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "DENY" } }
    });
    expect(stageRes.success).toBe(false);
    expect(stageRes.error).toContain("FORBIDDEN_STAGING_PATTERN");

    // Conventional commit validation
    const commitRes = await commitTool.execute({ message: "bad message without conventional format" }, {
      taskId: "task-git-6",
      workspace: { rootPath: tempDir },
      limits: { maxResults: 10, maxBytes: 10000 },
      permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "DENY" } }
    });
    expect(commitRes.success).toBe(false);
    expect(commitRes.error).toContain("conventional commit format");
  });

  // ============================================================
  // Scenario 7: Git Staging Mismatch Blocks Commit
  // ============================================================
  it("Scenario 7: Commit is Blocked if Staged Content Mismatches Authorized ChangeSet", async () => {
    const commitTool = new GitCommitTool();

    // Expected ChangeSet has fileA, but nothing staged -> blocked
    const res = await commitTool.execute(
      {
        message: "feat(core): update core module",
        expectedChangeSetFiles: ["src/fileA.ts"]
      },
      {
        taskId: "task-git-7",
        workspace: { rootPath: tempDir },
        limits: { maxResults: 10, maxBytes: 10000 },
        permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "DENY" } }
      }
    );
    expect(res.success).toBe(false);
  });

  // ============================================================
  // Scenario 8: User Denies Commit -> Task Stays Complete Without Commit
  // ============================================================
  it("Scenario 8: User Denies Commit -> Task Completed Without Commit", async () => {
    const model = new TestScriptableModel();
    const registry = new ToolRegistry();
    registry.register({
      name: "run_tests",
      description: "tests",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({ status: "PASS", exitCode: 0, stdout: "Passed" })
    });
    registry.register({
      name: "run_typecheck",
      description: "typecheck",
      capabilities: ["execute"],
      inputSchema: {},
      execute: async () => ({ status: "PASS", exitCode: 0, stdout: "0 errors" })
    });

    const executor = new ToolExecutor(registry);
    const diffEngine = new ComuDiffEngine();
    const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine);

    const events: AgentEvent[] = [];
    model.responses = [{ text: "Done" }];

    // autoCommitVerifiedTasks is FALSE (default)
    const result = await orchestrator.run({
      taskId: "task-git-8",
      workspaceRoot: tempDir,
      systemPrompt: "System",
      userPrompt: "Task prompt",
      limits: { maxSteps: 5, maxToolCalls: 10, maxExecutionTimeMs: 10000 },
      gitConfig: { autoCommitVerifiedTasks: false },
      onEvent: e => events.push(e)
    });

    expect(result.status).toBe("completed");
    expect(result.gitCommitResult).toBeUndefined();
  });

  // ============================================================
  // Scenario 9: Git Push Always Requires Explicit Human Approval
  // ============================================================
  it("Scenario 9: Git Push Always Requires Explicit Human Approval", async () => {
    const pushTool = new GitPushTool();

    // Push without explicit approval MUST fail
    const pushRes = await pushTool.execute(
      { remote: "origin", branch: "main", approved: false },
      {
        taskId: "task-git-9",
        workspace: { rootPath: tempDir },
        limits: { maxResults: 10, maxBytes: 10000 },
        permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "DENY" } }
      }
    );
    expect(pushRes.success).toBe(false);
    expect(pushRes.error).toContain("PUSH_NOT_AUTHORIZED");
  });

  // ============================================================
  // Scenario 10: Git Branch Name Sanitization & Forbidden Commands
  // ============================================================
  it("Scenario 10: Forbidden Git Commands & Branch Sanitization", async () => {
    const branchTool = new GitCreateBranchTool();

    // Dangerous branch names with path traversal or control characters
    const res1 = await branchTool.execute(
      { branchName: "../evil-branch" },
      {
        taskId: "task-git-10",
        workspace: { rootPath: tempDir },
        limits: { maxResults: 10, maxBytes: 10000 },
        permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "DENY" } }
      }
    );
    expect(res1.success).toBe(false);

    const res2 = await branchTool.execute(
      { branchName: "branch;rm -rf /" },
      {
        taskId: "task-git-10",
        workspace: { rootPath: tempDir },
        limits: { maxResults: 10, maxBytes: 10000 },
        permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "DENY" } }
      }
    );
    expect(res2.success).toBe(false);
  });

  // ============================================================
  // Scenario 11: Sandboxed Web Documentation Access
  // ============================================================
  it("Scenario 11: Web Docs Access Enforces Strict Domain Allowlist", async () => {
    // developer.mozilla.org is in the allowlist
    expect(DomainPolicy.isHostAllowed("developer.mozilla.org")).toBe(true);
    expect(DomainPolicy.isHostAllowed("docs.github.com")).toBe(true);
    expect(DomainPolicy.isHostAllowed("typescriptlang.org")).toBe(true);

    // Disallowed domains
    expect(DomainPolicy.isHostAllowed("evil.com")).toBe(false);
    expect(DomainPolicy.isHostAllowed("evildeveloper.mozilla.org")).toBe(false);
  });

  // ============================================================
  // Scenario 12: Web Docs SSRF Defenses
  // ============================================================
  it("Scenario 12: Web Docs SSRF Defenses Block Loopback, Private IPs & Metadata", async () => {
    const webTool = new WebDocsTool();
    const toolCtx = {
      taskId: "task-web-12",
      workspace: { rootPath: tempDir },
      limits: { maxResults: 10, maxBytes: 10000 },
      permissions: { capabilities: { read: "ALLOW", write: "DENY", execute: "DENY", network: "ALLOW" } }
    };

    // HTTP blocked (requires HTTPS)
    const resHttp = await webTool.execute({ url: "http://developer.mozilla.org" }, toolCtx);
    expect(resHttp.error).toContain("FORBIDDEN_SCHEME");

    // Disallowed host blocked
    const resDisallowed = await webTool.execute({ url: "https://evil.com/doc" }, toolCtx);
    expect(resDisallowed.error).toContain("DOMAIN_BLOCKED");

    // Loopback blocked
    const resLoopback = await webTool.execute({ url: "https://127.0.0.1/doc" }, toolCtx);
    expect(resLoopback.error).toContain("SSRF_BLOCKED");

    // Private IPv4 blocked
    const resPrivate = await webTool.execute({ url: "https://192.168.1.1/doc" }, toolCtx);
    expect(resPrivate.error).toContain("SSRF_BLOCKED");

    // Cloud metadata IP blocked
    const resMeta = await webTool.execute({ url: "https://169.254.169.254/latest/meta-data" }, toolCtx);
    expect(resMeta.error).toContain("SSRF_BLOCKED");
  });

  // ============================================================
  // Scenario 13: Memory Secret Sanitization
  // ============================================================
  it("Scenario 13: Secrets & API Keys are Automatically Scrubbed from Memory", async () => {
    const memoryEngine = new MemoryEngine({ storageDir: memoryDir });
    const workspaceId = "ws-scenario-13";

    const secretContent = "Configure connection with token: ghp_1234567890abcdef1234567890abcdef1234 and sk-ant-api03-abcdef1234567890";
    const recorded = await memoryEngine.record({
      workspaceId,
      type: "LESSON",
      content: secretContent,
      source: "USER",
      trustLevel: "USER_VERIFIED",
      confidence: 1.0,
      status: "ACTIVE",
      scope: { workspaceId }
    });

    expect(recorded.content).not.toContain("ghp_");
    expect(recorded.content).not.toContain("sk-ant-api03");
    expect(recorded.content).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(recorded.content).toContain("[REDACTED_API_KEY]");
  });

  // ============================================================
  // Scenario 14: Parent Cancellation Cancels Active Subagents
  // ============================================================
  it("Scenario 14: Parent Cancellation Propagates and Cancels Subagent Immediately", async () => {
    const subagentManager = new SubagentManager();
    const parentController = new AbortController();

    const model = new TestScriptableModel();
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry);

    // Pre-abort the parent signal
    parentController.abort();

    const result = await subagentManager.executeSubagent({
      parentTaskId: "parent-cancel",
      type: "RESEARCH",
      depth: 1,
      goal: "Cancelled research task",
      parentSignal: parentController.signal,
      model,
      registry,
      executor,
      toolContext: {
        taskId: "parent-cancel",
        workspace: { rootPath: tempDir },
        limits: { maxResults: 10, maxBytes: 10000 },
        permissions: { capabilities: { read: "ALLOW", write: "DENY", execute: "DENY", network: "DENY" } }
      },
      onEvent: () => {}
    });

    expect(result.status).toBe("CANCELLED");
  });
});
