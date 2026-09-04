import path from "node:path";
import { AgentTool, ToolCapability, ToolContext } from "@comu/tool-core";
import { ProcessManager, CommandPlan } from "@comu/terminal";
import { GitStageResult } from "@comu/protocol";

export class GitStageFilesTool implements AgentTool<any, GitStageResult> {
  name = "git_stage_files";
  description = "Stage specifically authorized files for commit. Rejects arbitrary staging and enforces ChangeSet confinement.";
  capabilities: ToolCapability[] = ["execute"];
  inputSchema = {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: { type: "string" },
        description: "Exact relative paths to stage"
      },
      authorizedFiles: {
        type: "array",
        items: { type: "string" },
        description: "List of authorized ChangeSet files"
      }
    },
    required: ["files"]
  };

  private processManager = new ProcessManager();

  async execute(
    args: { files: string[]; authorizedFiles?: string[] },
    context: ToolContext
  ): Promise<GitStageResult> {
    const cwd = context.workspace.rootPath;
    const requestedFiles = args.files;

    if (!Array.isArray(requestedFiles) || requestedFiles.length === 0) {
      return {
        success: false,
        stagedFiles: [],
        cachedDiff: "",
        matchesChangeSet: false,
        error: "No files specified for staging."
      };
    }

    // Defense: Disallow arbitrary '.' or wildcard staging
    if (requestedFiles.some(f => f.trim() === "." || f.includes("*") || f.includes("?"))) {
      return {
        success: false,
        stagedFiles: [],
        cachedDiff: "",
        matchesChangeSet: false,
        error: "FORBIDDEN_STAGING_PATTERN: Wildcard or dot staging is strictly forbidden."
      };
    }

    // Normalize and check against authorized files if provided
    const authorizedSet = args.authorizedFiles
      ? new Set(args.authorizedFiles.map(f => path.normalize(f).replace(/\\/g, "/")))
      : undefined;

    const normalizedRequested: string[] = [];
    for (const f of requestedFiles) {
      const norm = path.normalize(f).replace(/\\/g, "/");
      if (authorizedSet && !authorizedSet.has(norm)) {
        return {
          success: false,
          stagedFiles: [],
          cachedDiff: "",
          matchesChangeSet: false,
          error: `UNAUTHORIZED_STAGING_FILE: File '${norm}' is not authorized by the active ChangeSet.`
        };
      }
      normalizedRequested.push(norm);
    }

    // Execute git add -- <files>
    const addPlan: CommandPlan = {
      executable: "git",
      args: ["add", "--", ...normalizedRequested],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };

    const addRes = await this.processManager.start(addPlan, { timeoutMs: 10000 });
    if (addRes.exitCode !== 0) {
      return {
        success: false,
        stagedFiles: [],
        cachedDiff: "",
        matchesChangeSet: false,
        error: addRes.stderr || "Failed to stage files in git."
      };
    }

    // Inspect git diff --cached --name-only
    const nameOnlyPlan: CommandPlan = {
      executable: "git",
      args: ["diff", "--cached", "--name-only"],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };
    const nameOnlyRes = await this.processManager.start(nameOnlyPlan, { timeoutMs: 5000 });
    const stagedFiles = nameOnlyRes.stdout
      .split("\n")
      .map(s => s.trim().replace(/\\/g, "/"))
      .filter(s => s.length > 0);

    // Inspect git diff --cached
    const diffPlan: CommandPlan = {
      executable: "git",
      args: ["diff", "--cached"],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };
    const diffRes = await this.processManager.start(diffPlan, { timeoutMs: 5000 });
    const cachedDiff = diffRes.stdout.slice(0, 50000); // Bounded cached diff

    // Check if staged files match authorized files
    let matchesChangeSet = true;
    if (authorizedSet) {
      for (const staged of stagedFiles) {
        if (!authorizedSet.has(staged)) {
          matchesChangeSet = false;
          break;
        }
      }
    }

    return {
      success: matchesChangeSet,
      stagedFiles,
      cachedDiff,
      matchesChangeSet,
      error: matchesChangeSet ? undefined : "Staged files contain unauthorized modifications outside ChangeSet."
    };
  }
}
