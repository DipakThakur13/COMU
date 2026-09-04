import { AgentTool, ToolCapability, ToolContext } from '@comu/tool-core';
import { ProcessManager, CommandPlan } from '@comu/terminal';
import { normalize, resolve } from 'path';

export interface GitStatusResult {
  isRepository: boolean;
  branch?: string;
  staged: string[];
  modified: string[];
  deleted: string[];
  untracked: string[];
}

export class GitStatusTool implements AgentTool<any, GitStatusResult> {
  name = "git_status";
  description = "Get the status of the git repository in the workspace. Returns structured info on staged, modified, deleted, and untracked files.";
  capabilities: ToolCapability[] = ["read"];
  inputSchema = {
    type: "object",
    properties: {}
  };

  private processManager = new ProcessManager();

  async execute(args: any, context: ToolContext): Promise<GitStatusResult> {
    const cwd = context.workspace.rootPath;

    // Check if it's a git repo
    const checkPlan: CommandPlan = {
      executable: 'git',
      args: ['rev-parse', '--is-inside-work-tree'],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };

    const checkResult = await this.processManager.start(checkPlan, { timeoutMs: 5000 });
    if (checkResult.exitCode !== 0) {
      return {
        isRepository: false,
        staged: [],
        modified: [],
        deleted: [],
        untracked: []
      };
    }

    const branchPlan: CommandPlan = {
      executable: 'git',
      args: ['branch', '--show-current'],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };
    const branchResult = await this.processManager.start(branchPlan, { timeoutMs: 5000 });
    const branch = branchResult.stdout.trim();

    const statusPlan: CommandPlan = {
      executable: 'git',
      args: ['status', '--porcelain'],
      cwd,
      source: "AGENT",
      category: "SAFE_DEVELOPMENT"
    };
    const statusResult = await this.processManager.start(statusPlan, { timeoutMs: 5000 });
    
    const lines = statusResult.stdout.split('\n').filter(l => l.trim() !== '');
    const staged: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const x = line.charAt(0);
      const y = line.charAt(1);
      const file = line.substring(3).trim();

      if (x === 'A' || x === 'M' || x === 'D' || x === 'R' || x === 'C') {
        staged.push(file);
      }
      if (y === 'M') {
        modified.push(file);
      }
      if (y === 'D') {
        deleted.push(file);
      }
      if (x === '?' && y === '?') {
        untracked.push(file);
      }
    }

    return {
      isRepository: true,
      branch: branch || undefined,
      staged,
      modified,
      deleted,
      untracked
    };
  }
}
