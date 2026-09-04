import path from "node:path";
import { AgentTool, ToolCapability, ToolContext } from "@comu/tool-core";
import { ProcessManager, CommandPlan } from "@comu/terminal";
import { GitCommitResult } from "@comu/protocol";

export class GitCommitTool implements AgentTool<any, GitCommitResult> {
  name = "git_commit";
  description = "Create a git commit with conventional commit message validation and staged file verification.";
  capabilities: ToolCapability[] = ["execute"];
  inputSchema = {
    type: "object",
    properties: {
      message: { type: "string", description: "Conventional commit message" },
      authorizedFiles: {
        type: "array",
        items: { type: "string" },
        description: "List of authorized ChangeSet files to verify against staged changes"
      }
    },
    required: ["message"]
  };

  private processManager = new ProcessManager();

  public static validateCommitMessage(message: string): { valid: boolean; error?: string } {
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return { valid: false, error: "Commit message cannot be empty." };
    }
    if (message.length > 1000) {
      return { valid: false, error: "Commit message exceeds 1000 characters." };
    }
    // Conventional commit format
    const conventionalRegex =
      /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([a-zA-Z0-9_\-\.\/]+\))?!?: .+/s;
    if (!conventionalRegex.test(message.trim())) {
      return {
        valid: false,
        error: "Commit message must follow conventional commit format (e.g. 'feat(auth): add middleware', 'fix: resolve bug')."
      };
    }
    return { valid: true };
  }

  async execute(
    args: { message: string; authorizedFiles?: string[] },
    context: ToolContext
  ): Promise<GitCommitResult> {
    const cwd = context.workspace.rootPath;
    const rawMessage = args.message;

    const validation = GitCommitTool.validateCommitMessage(rawMessage);
    if (!validation.valid) {
      return {
        success: false,
        message: rawMessage || "",
        branch: "",
        fileCount: 0,
        error: validation.error
      };
    }

    // Inspect staged files
    const stagedPlan: CommandPlan = {
      executable: "git",
      args: ["diff", "--cached", "--name-only"],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };
    const stagedRes = await this.processManager.start(stagedPlan, { timeoutMs: 5000 });
    const stagedFiles = stagedRes.stdout
      .split("\n")
      .map(s => s.trim().replace(/\\/g, "/"))
      .filter(s => s.length > 0);

    if (stagedFiles.length === 0) {
      return {
        success: false,
        message: rawMessage,
        branch: "",
        fileCount: 0,
        error: "NOTHING_STAGED: No staged changes found to commit."
      };
    }

    // If authorizedFiles provided, verify all staged files are authorized
    if (args.authorizedFiles && args.authorizedFiles.length > 0) {
      const authorizedSet = new Set(args.authorizedFiles.map(f => path.normalize(f).replace(/\\/g, "/")));
      for (const file of stagedFiles) {
        if (!authorizedSet.has(file)) {
          return {
            success: false,
            message: rawMessage,
            branch: "",
            fileCount: stagedFiles.length,
            error: `STAGING_MISMATCH: Staged file '${file}' is not in the authorized ChangeSet list.`
          };
        }
      }
    }

    // Get current branch
    const branchPlan: CommandPlan = {
      executable: "git",
      args: ["branch", "--show-current"],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };
    const branchRes = await this.processManager.start(branchPlan, { timeoutMs: 5000 });
    const branch = branchRes.stdout.trim();

    // Execute commit
    const commitPlan: CommandPlan = {
      executable: "git",
      args: ["commit", "-m", rawMessage.trim()],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };
    const commitRes = await this.processManager.start(commitPlan, { timeoutMs: 10000 });
    if (commitRes.exitCode !== 0) {
      return {
        success: false,
        message: rawMessage,
        branch,
        fileCount: stagedFiles.length,
        error: commitRes.stderr || "Git commit command failed."
      };
    }

    // Get commit hash
    const revPlan: CommandPlan = {
      executable: "git",
      args: ["rev-parse", "HEAD"],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };
    const revRes = await this.processManager.start(revPlan, { timeoutMs: 5000 });
    const commitHash = revRes.stdout.trim();

    return {
      success: true,
      commitHash,
      message: rawMessage.trim(),
      branch,
      fileCount: stagedFiles.length
    };
  }
}
