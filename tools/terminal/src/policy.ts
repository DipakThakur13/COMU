import { CommandPlan, CommandDecision, CommandCategory } from './command_plan';

export class CommandPolicy {
  private static readonly SAFE_EXECUTABLES = new Set([
    'node', 'npm', 'pnpm', 'yarn',
    'tsc', 'eslint', 'prettier', 'jest', 'mocha', 'vitest',
    'python', 'pytest',
    'go',
    'cargo', 'rustc',
    'java', 'javac', 'mvn', 'gradle',
    'git'
  ]);

  /**
   * Git subcommands that only read. Safe for any caller, including a model-originated terminal
   * call, because none of them changes the repository or the working tree.
   */
  private static readonly GIT_READONLY = new Set([
    'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file',
    'describe', 'blame', 'shortlog', 'symbolic-ref', 'merge-base', 'name-rev', 'var'
  ]);

  /**
   * Git subcommands that change the repository. Allowed only for the governed git tools, which
   * apply their own staging restrictions, commit-message validation and human approval. The
   * terminal tool cannot reach these, so a model cannot commit or push by shelling out and
   * side-stepping the approval gate.
   */
  private static readonly GIT_GOVERNED = new Set([
    'add', 'commit', 'push', 'checkout', 'switch', 'branch', 'restore', 'stash'
  ]);

  /**
   * Never allowed, from any source. Each destroys work or rewrites history, and none is something
   * COMU needs in order to do its job.
   */
  private static readonly GIT_FORBIDDEN_SUBCOMMANDS = new Set([
    'rebase', 'filter-branch', 'filter-repo', 'reflog', 'gc', 'prune', 'update-ref',
    'replace', 'fsck', 'am', 'cherry-pick', 'revert', 'merge', 'pull', 'clone', 'init',
    'submodule', 'worktree', 'daemon', 'credential', 'config'
  ]);

  private static readonly DESTRUCTIVE_EXECUTABLES = new Set([
    'rm', 'rmdir', 'del', 'format', 'mkfs', 'dd', 'shutdown', 'reboot'
  ]);

  private static readonly NETWORK_EXECUTABLES = new Set([
    'curl', 'wget', 'ssh', 'scp', 'ftp', 'sftp', 'nc', 'ping', 'telnet'
  ]);

  /**
   * `%` and `^` are included because a Windows batch shim still has to be started through cmd.exe,
   * which performs `%VAR%` expansion and treats `^` as an escape. Neither appears in a normal
   * development command, so rejecting them costs nothing and closes the gap the old
   * `shell: true` spawn left open.
   */
  private static readonly SHELL_INJECTION_CHARS = /([;&|><$`%^]|\$\()/;

  public evaluate(plan: CommandPlan): CommandDecision {
    // 1. Defend against shell injection in executable or args
    if (this.hasShellInjection(plan.executable) || plan.args.some(arg => this.hasShellInjection(arg))) {
      return {
        decision: "DENY",
        category: "RESTRICTED",
        reason: "Command contains shell injection or unapproved shell operators."
      };
    }

    const execBaseWithExt = plan.executable.split(/[/\\]/).pop()?.toLowerCase() || '';
    const execBase = execBaseWithExt.split('.')[0];

    // 2. Protect against inline interpreters
    if (this.isInlineInterpreter(execBase, plan.args)) {
      return {
        decision: "DENY",
        category: "RESTRICTED",
        reason: "Inline interpreter execution (e.g., node -e, python -c) is restricted."
      };
    }

    // 3. Destructive commands
    if (CommandPolicy.DESTRUCTIVE_EXECUTABLES.has(execBase)) {
      return {
        decision: "DENY",
        category: "DESTRUCTIVE",
        reason: `Executable '${execBase}' is categorized as destructive.`
      };
    }

    // 4. Network commands
    if (CommandPolicy.NETWORK_EXECUTABLES.has(execBase)) {
      return {
        decision: "DENY",
        category: "NETWORK",
        reason: `Executable '${execBase}' is categorized as network-capable.`
      };
    }

    // 5. Git is allowed by subcommand, not wholesale.
    if (execBase === 'git') {
      return this.evaluateGit(plan);
    }

    // 6. Safe Development commands
    if (CommandPolicy.SAFE_EXECUTABLES.has(execBase)) {
      // Further checks e.g. for npm publish
      if ((execBase === 'npm' || execBase === 'pnpm' || execBase === 'yarn') && plan.args.includes('publish')) {
        return {
          decision: "DENY",
          category: "NETWORK",
          reason: "Package publishing is restricted."
        };
      }
      return {
        decision: "ALLOW",
        category: "SAFE_DEVELOPMENT",
        reason: "Command is an approved development tool."
      };
    }

    // UNKNOWN
    return {
      decision: "DENY",
      category: "UNKNOWN",
      reason: `Executable '${execBase}' is not on the allowed development tools list.`
    };
  }

  /**
   * Git's surface is decided per subcommand and per caller, not by the executable alone.
   *
   * Routing the git tools through here is what gives them cancellation, output bounds and an audit
   * trail; before this they called the process manager directly, so Stop did not reach them and a
   * push could complete after the user cancelled it.
   */
  private evaluateGit(plan: CommandPlan): CommandDecision {
    const args = plan.args.filter(a => !a.startsWith('-'));
    const subcommand = (args[0] ?? '').toLowerCase();
    const flags = plan.args.filter(a => a.startsWith('-')).map(a => a.toLowerCase());
    const has = (...names: string[]) => names.some(n => flags.includes(n));

    if (!subcommand) {
      return { decision: "DENY", category: "UNKNOWN", reason: "git requires a subcommand." };
    }

    if (CommandPolicy.GIT_FORBIDDEN_SUBCOMMANDS.has(subcommand)) {
      return {
        decision: "DENY",
        category: "DESTRUCTIVE",
        reason: `git ${subcommand} is permanently forbidden: it rewrites history, reaches the network unsupervised, or changes repository configuration.`
      };
    }

    // Destructive flag combinations, forbidden regardless of who is asking.
    if (subcommand === 'reset' && has('--hard', '--merge', '--keep')) {
      return { decision: "DENY", category: "DESTRUCTIVE", reason: "git reset --hard discards uncommitted work and is permanently forbidden." };
    }
    if (subcommand === 'clean' && has('-f', '-fd', '-fdx', '-d', '-x', '--force')) {
      return { decision: "DENY", category: "DESTRUCTIVE", reason: "git clean deletes untracked files and is permanently forbidden." };
    }
    if ((subcommand === 'checkout' || subcommand === 'switch' || subcommand === 'restore') && has('-f', '--force', '--discard-changes')) {
      return { decision: "DENY", category: "DESTRUCTIVE", reason: `git ${subcommand} --force discards uncommitted work and is permanently forbidden.` };
    }
    if (subcommand === 'push' && has('-f', '--force', '--force-with-lease', '--delete', '--mirror', '--prune')) {
      return { decision: "DENY", category: "DESTRUCTIVE", reason: "A force, delete, mirror or prune push rewrites remote history and is permanently forbidden." };
    }
    if (subcommand === 'branch' && has('-d', '-D', '--delete', '-m', '-M', '--move')) {
      return { decision: "DENY", category: "DESTRUCTIVE", reason: "Deleting or renaming a branch is permanently forbidden." };
    }
    if (subcommand === 'tag' && has('-d', '--delete')) {
      return { decision: "DENY", category: "DESTRUCTIVE", reason: "Deleting a tag is permanently forbidden." };
    }
    if (subcommand === 'stash' && args.slice(1).some(a => ['drop', 'clear', 'pop'].includes(a.toLowerCase()))) {
      return { decision: "DENY", category: "DESTRUCTIVE", reason: "Dropping or popping a stash can discard work and is permanently forbidden." };
    }
    if (subcommand === 'reset') {
      // A soft or mixed reset still moves HEAD; only the governed tools may do it.
      return plan.source === "GIT"
        ? { decision: "ALLOW", category: "SAFE_DEVELOPMENT", reason: "Governed git tool performing a non-destructive reset." }
        : { decision: "DENY", category: "RESTRICTED", reason: "git reset is available only to COMU's governed git tools." };
    }

    if (CommandPolicy.GIT_READONLY.has(subcommand)) {
      return { decision: "ALLOW", category: "OBSERVABILITY", reason: `git ${subcommand} only reads repository state.` };
    }

    if (CommandPolicy.GIT_GOVERNED.has(subcommand)) {
      if (plan.source === "GIT") {
        return { decision: "ALLOW", category: "SAFE_DEVELOPMENT", reason: `Governed git tool performing git ${subcommand}.` };
      }
      return {
        decision: "DENY",
        category: "RESTRICTED",
        reason: `git ${subcommand} is available only to COMU's governed git tools, which apply staging limits, commit validation and human approval. It cannot be run from the terminal.`
      };
    }

    return { decision: "DENY", category: "UNKNOWN", reason: `git ${subcommand} is not on the allowed subcommand list.` };
  }

  private hasShellInjection(str: string): boolean {
    return CommandPolicy.SHELL_INJECTION_CHARS.test(str);
  }

  private isInlineInterpreter(exec: string, args: string[]): boolean {
    if (exec === 'node' && (args.includes('-e') || args.includes('--eval'))) return true;
    if ((exec === 'python' || exec === 'python3') && (args.includes('-c') || args.includes('--command'))) return true;
    if (exec === 'ruby' && args.includes('-e')) return true;
    if (exec === 'php' && args.includes('-r')) return true;
    return false;
  }
}
