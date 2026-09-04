import { AgentTool, ToolCapability, ToolContext } from "@comu/tool-core";
import { ProcessManager, CommandPlan } from "@comu/terminal";
import { GitPushResult } from "@comu/protocol";

export class GitPushTool implements AgentTool<any, GitPushResult> {
  name = "git_push";
  description = "Push committed changes to a remote repository. Strictly requires explicit human approval.";
  capabilities: ToolCapability[] = ["execute"];
  inputSchema = {
    type: "object",
    properties: {
      remote: { type: "string", description: "Remote repository name, defaults to origin" },
      branch: { type: "string", description: "Remote branch name" },
      approved: { type: "boolean", description: "Explicit developer approval flag" }
    },
    required: ["approved"]
  };

  private processManager = new ProcessManager();

  async execute(
    args: { remote?: string; branch?: string; approved?: boolean },
    context: ToolContext
  ): Promise<GitPushResult> {
    const cwd = context.workspace.rootPath;
    const remote = args.remote || "origin";

    // Strict invariant: Push ALWAYS requires explicit approval
    if (!args.approved) {
      return {
        success: false,
        remote,
        branch: args.branch || "",
        commitHash: "",
        error: "PUSH_NOT_AUTHORIZED: git push strictly requires explicit human approval."
      };
    }

    if (!/^[a-zA-Z0-9_\-]+$/.test(remote)) {
      return {
        success: false,
        remote,
        branch: args.branch || "",
        commitHash: "",
        error: `Invalid git remote name: '${remote}'`
      };
    }

    // Determine branch if not specified
    let branch = args.branch;
    if (!branch) {
      const branchPlan: CommandPlan = {
        executable: "git",
        args: ["branch", "--show-current"],
        cwd,
        source: "AGENT",
        category: "SAFE_DEVELOPMENT"
      };
      const branchRes = await this.processManager.start(branchPlan, { timeoutMs: 5000 });
      branch = branchRes.stdout.trim();
    }

    if (!branch || branch === "HEAD") {
      return {
        success: false,
        remote,
        branch: branch || "",
        commitHash: "",
        error: "Cannot push from detached HEAD state."
      };
    }

    // Get current commit hash
    const revPlan: CommandPlan = {
      executable: "git",
      args: ["rev-parse", "HEAD"],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };
    const revRes = await this.processManager.start(revPlan, { timeoutMs: 5000 });
    const commitHash = revRes.stdout.trim();

    // Execute git push <remote> <branch>
    const pushPlan: CommandPlan = {
      executable: "git",
      args: ["push", remote, branch],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };
    const pushRes = await this.processManager.start(pushPlan, { timeoutMs: 30000 });
    if (pushRes.exitCode !== 0) {
      return {
        success: false,
        remote,
        branch,
        commitHash,
        error: pushRes.stderr || "Git push failed."
      };
    }

    return {
      success: true,
      remote,
      branch,
      commitHash
    };
  }
}
