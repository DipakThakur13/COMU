import { AgentTool, ToolCapability, ToolContext } from '@comu/tool-core';
import { ProcessManager, CommandPlan } from '@comu/terminal';

export interface GitDiffArgs {
  staged?: boolean;
  file?: string;
}

export interface GitDiffResult {
  diff: string;
  truncated: boolean;
}

export class GitDiffTool implements AgentTool<GitDiffArgs, GitDiffResult> {
  name = "git_diff";
  description = "Get the diff of the git repository. Use staged=true to view staged changes, or pass a file to view specific changes.";
  capabilities: ToolCapability[] = ["read"];
  inputSchema = {
    type: "object",
    properties: {
      staged: {
        type: "boolean",
        description: "If true, shows the diff of staged changes. If false, shows working tree changes."
      },
      file: {
        type: "string",
        description: "Optional relative path to a file to diff."
      }
    }
  };

  private processManager = new ProcessManager();

  async execute(args: GitDiffArgs, context: ToolContext): Promise<GitDiffResult> {
    const cwd = context.workspace.rootPath;

    const cmdArgs = ['diff'];
    if (args.staged) {
      cmdArgs.push('--staged');
    }
    if (args.file) {
      // Security: verify no shell injection in filename, though spawn(shell: false) mitigates mostly
      if (args.file.startsWith('-')) {
         throw new Error("Invalid file argument");
      }
      cmdArgs.push('--', args.file);
    }

    const diffPlan: CommandPlan = {
      executable: 'git',
      args: cmdArgs,
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };

    const result = await this.processManager.start(diffPlan, {
      timeoutMs: 10000,
      maxStdoutBytes: context.limits.maxBytes || 500 * 1024 // default 500KB diff
    });

    return {
      diff: result.stdout,
      truncated: result.stdoutTruncated
    };
  }
}
