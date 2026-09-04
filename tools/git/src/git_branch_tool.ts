import fs from "node:fs";
import path from "node:path";
import { AgentTool, ToolCapability, ToolContext } from "@comu/tool-core";
import { ProcessManager, CommandPlan } from "@comu/terminal";
import { GitBranchResult } from "@comu/protocol";

export class GitCreateBranchTool implements AgentTool<any, GitBranchResult> {
  name = "git_create_branch";
  description = "Create a new git branch safely for task isolation with pre-branch validation.";
  capabilities: ToolCapability[] = ["execute"];
  inputSchema = {
    type: "object",
    properties: {
      branchName: { type: "string", description: "Name of the branch to create" },
      baseBranch: { type: "string", description: "Optional base branch to branch from" }
    },
    required: ["branchName"]
  };

  private processManager = new ProcessManager();

  public static sanitizeBranchName(name: string): string {
    return name
      .trim()
      .replace(/[\s~^:?*\[\\]+/g, "-")
      .replace(/\.\.+/g, ".")
      .replace(/^\/+|\/+$/g, "")
      .replace(/^-+/, "");
  }

  async execute(args: { branchName: string; baseBranch?: string }, context: ToolContext): Promise<GitBranchResult> {
    const cwd = context.workspace.rootPath;
    const rawBranchName = args.branchName;

    if (!rawBranchName || typeof rawBranchName !== "string") {
      return { success: false, branchName: "", created: false, error: "Invalid branch name provided." };
    }

    const branchName = GitCreateBranchTool.sanitizeBranchName(rawBranchName);
    if (!branchName || !/^[a-zA-Z0-9_\-\.\/]+$/.test(branchName) || branchName.startsWith("-")) {
      return { success: false, branchName, created: false, error: `Disallowed branch name format: '${rawBranchName}'` };
    }

    // Inspect git internal state directory
    const gitDir = path.join(cwd, ".git");
    if (fs.existsSync(gitDir)) {
      if (fs.existsSync(path.join(gitDir, "MERGE_HEAD"))) {
        return { success: false, branchName, created: false, error: "Merge in progress. Cannot branch." };
      }
      if (fs.existsSync(path.join(gitDir, "rebase-apply")) || fs.existsSync(path.join(gitDir, "rebase-merge"))) {
        return { success: false, branchName, created: false, error: "Rebase in progress. Cannot branch." };
      }
      if (fs.existsSync(path.join(gitDir, "CHERRY_PICK_HEAD"))) {
        return { success: false, branchName, created: false, error: "Cherry-pick in progress. Cannot branch." };
      }
    }

    // Check current branch
    const currentBranchPlan: CommandPlan = {
      executable: "git",
      args: ["branch", "--show-current"],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };
    const currentRes = await this.processManager.start(currentBranchPlan, { timeoutMs: 5000 });
    const previousBranch = currentRes.stdout.trim() || undefined;

    if (!previousBranch || previousBranch === "HEAD") {
      return {
        success: false,
        branchName,
        created: false,
        error: "AMBIGUOUS_GIT_STATE: Repository is in detached HEAD state. Cannot safely branch."
      };
    }

    // Check if branch already exists
    const checkExistsPlan: CommandPlan = {
      executable: "git",
      args: ["rev-parse", "--verify", `refs/heads/${branchName}`],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };
    const existsRes = await this.processManager.start(checkExistsPlan, { timeoutMs: 5000 });
    if (existsRes.exitCode === 0) {
      return {
        success: false,
        branchName,
        created: false,
        previousBranch,
        error: `Branch '${branchName}' already exists.`
      };
    }

    // Create and checkout branch
    const checkoutArgs = ["checkout", "-b", branchName];
    if (args.baseBranch) {
      checkoutArgs.push(args.baseBranch);
    }

    const checkoutPlan: CommandPlan = {
      executable: "git",
      args: checkoutArgs,
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };
    const checkoutRes = await this.processManager.start(checkoutPlan, { timeoutMs: 5000 });
    if (checkoutRes.exitCode !== 0) {
      return {
        success: false,
        branchName,
        created: false,
        previousBranch,
        error: checkoutRes.stderr || "Failed to checkout new branch."
      };
    }

    return {
      success: true,
      branchName,
      created: true,
      previousBranch
    };
  }
}
