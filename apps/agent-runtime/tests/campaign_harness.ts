import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { AgentEvent, WorkspaceMemoryEntry } from "@comu/protocol";
import { ToolRegistry, ToolExecutor } from "@comu/tool-core";
import { ComuDiffEngine } from "@comu/diff-engine";
import { AgentOrchestrator, OrchestratorContext, SubagentManager } from "@comu/agent-core";
import { MemoryEngine } from "@comu/memory-engine";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";

export interface RepoBaseline {
  repoPath: string;
  initialBranch: string;
  initialGitStatus: string;
  initialUncommittedChanges: string[];
  initialFileCount: number;
  framework: string;
}

export interface ScenarioMetrics {
  scenarioId: string;
  name: string;
  status: "PASS" | "FAIL" | "PARTIAL" | "BLOCKED";
  correctness: boolean;
  safety: boolean;
  verification: {
    requiredChecksPassed: boolean;
    checks: string[];
  };
  filesRead: string[];
  filesModified: string[];
  filesCreated: string[];
  filesStaged: string[];
  toolUsage: {
    filesystem: number;
    search: number;
    terminal: number;
    git: number;
    web: number;
    worker: number;
  };
  validationRuns: number;
  repairAttempts: number;
  durationMs: number;
  userChangesPreserved: boolean;
  unauthorizedGitChanges: boolean;
  workerEscalations: number;
  memoryRetrievedCount: number;
  memoryStaleOverridden: boolean;
  completionGateHonored: boolean;
  reason: string;
}

export class ScriptableCampaignModel implements ModelProvider {
  id = "campaign-scriptable-model";
  name = "Campaign Scriptable Model";
  private responses: ModelResponse[] = [];

  constructor(responses?: ModelResponse[]) {
    if (responses) {
      this.responses = [...responses];
    }
  }

  setResponses(responses: ModelResponse[]) {
    this.responses = [...responses];
  }

  addResponse(response: ModelResponse) {
    this.responses.push(response);
  }

  getCapabilities() {
    return {
      toolCalling: true,
      streaming: false,
      reasoning: false,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 2000
    };
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    const next = this.responses.shift();
    if (!next) {
      return { text: "Investigation complete." };
    }
    return next;
  }
}

export class CampaignHarness {
  public static createRepoFixture(
    targetDir: string,
    initialFiles: Record<string, string>,
    options?: {
      uncommittedFiles?: Record<string, string>;
      detachedHead?: boolean;
      branchName?: string;
    }
  ): RepoBaseline {
    fs.mkdirSync(targetDir, { recursive: true });

    // Write initial baseline files
    for (const [relPath, content] of Object.entries(initialFiles)) {
      const fullPath = path.join(targetDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
    }

    // Initialize git
    try {
      execSync("git init -b main", { cwd: targetDir, stdio: "ignore" });
      execSync('git config user.name "COMU Campaign"', { cwd: targetDir, stdio: "ignore" });
      execSync('git config user.email "comu-campaign@example.com"', { cwd: targetDir, stdio: "ignore" });
      execSync("git add .", { cwd: targetDir, stdio: "ignore" });
      execSync('git commit -m "initial baseline commit"', { cwd: targetDir, stdio: "ignore" });

      if (options?.branchName) {
        execSync(`git branch -M "${options.branchName}"`, { cwd: targetDir, stdio: "ignore" });
      }

      if (options?.detachedHead) {
        execSync("git checkout --detach HEAD", { cwd: targetDir, stdio: "ignore" });
      }
    } catch {
      // Git command fallback if git not available
    }

    const initialUncommittedChanges: string[] = [];
    if (options?.uncommittedFiles) {
      for (const [relPath, content] of Object.entries(options.uncommittedFiles)) {
        const fullPath = path.join(targetDir, relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, "utf8");
        initialUncommittedChanges.push(relPath);
      }
    }

    let initialStatus = "";
    let initialBranch = "main";
    try {
      initialStatus = execSync("git status --short", { cwd: targetDir, encoding: "utf8" });
      initialBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: targetDir, encoding: "utf8" }).trim();
    } catch {}

    return {
      repoPath: targetDir,
      initialBranch,
      initialGitStatus: initialStatus,
      initialUncommittedChanges,
      initialFileCount: Object.keys(initialFiles).length + (options?.uncommittedFiles ? Object.keys(options.uncommittedFiles).length : 0),
      framework: initialFiles["package.json"] ? "node/ts" : initialFiles["pyproject.toml"] ? "python" : "generic"
    };
  }
}
