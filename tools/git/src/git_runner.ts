import { ToolContext, throwIfAborted } from "@comu/tool-core";
import { TaskCancelledError, ToolError } from "@comu/shared";
import { CommandPlan, CommandPolicy, CommandResult, ProcessManager } from "@comu/terminal";

/**
 * The one way a git tool runs a command.
 *
 * The git tools used to build a `CommandPlan` and call `ProcessManager` directly, which meant two
 * command paths with different safety properties: the terminal path was policy-checked, bounded
 * and cancellable, and the git path was none of those. Cancelling a task during `git push` did not
 * stop the push, which made the approval card's promise about push control untrue in the one case
 * that is irreversible.
 *
 * Everything now goes through `CommandPolicy`, which knows git by subcommand, and carries the
 * task's abort signal into the process so Stop actually reaches the child process tree.
 */
export class GitRunner {
  private static readonly policy = new CommandPolicy();
  private static readonly processManager = new ProcessManager();

  /**
   * Runs a git command on behalf of a governed git tool.
   *
   * `source: "GIT"` is what lets the policy allow the mutating subcommands (add, commit, push)
   * that a model-originated terminal call must never reach. The forbidden set — history rewriting,
   * force pushes, hard resets, clean — is refused here too, whoever is asking.
   */
  public static async run(
    args: string[],
    context: ToolContext,
    options: { timeoutMs?: number; maxStdoutBytes?: number } = {}
  ): Promise<CommandResult> {
    throwIfAborted(context.abortSignal, `git ${args[0] ?? ""}`.trim());

    const plan: CommandPlan = {
      executable: "git",
      args,
      cwd: context.workspace.rootPath,
      source: "GIT"
    };

    const decision = GitRunner.policy.evaluate(plan);
    if (decision.decision !== "ALLOW") {
      throw new ToolError(`COMMAND_DENIED: ${decision.reason} (Category: ${decision.category})`);
    }

    const result = await GitRunner.processManager.start(plan, {
      timeoutMs: options.timeoutMs ?? 10_000,
      maxStdoutBytes: options.maxStdoutBytes ?? context.limits?.maxStdoutBytes ?? 1024 * 1024,
      maxStderrBytes: context.limits?.maxStderrBytes ?? 256 * 1024,
      maxCombinedOutputBytes: context.limits?.maxCombinedOutputBytes ?? 2 * 1024 * 1024,
      abortSignal: context.abortSignal
    });

    if (result.cancelled) {
      throw new TaskCancelledError(`git ${args[0] ?? ""} was cancelled`.trim());
    }

    return result;
  }
}
