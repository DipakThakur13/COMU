export type CommandCategory = "SAFE_DEVELOPMENT" | "OBSERVABILITY" | "RESTRICTED" | "DESTRUCTIVE" | "NETWORK" | "UNKNOWN";

/**
 * Who asked for this command.
 *
 * "AGENT" is a model-originated terminal call and gets the narrowest git surface. "GIT" is one of
 * the governed git tools, which carry their own staging, commit-message and approval rules, so the
 * policy trusts them with the mutating subcommands the terminal tool must never have.
 */
export type CommandSource = "AGENT" | "VALIDATION" | "EXTENSION" | "GIT";

export interface CommandPlan {
  executable: string;
  args: string[];
  cwd: string;
  source: CommandSource;
  category?: CommandCategory;
}

export interface CommandDecision {
  decision: "ALLOW" | "DENY";
  category: CommandCategory;
  reason: string;
}

export interface CommandResult {
  commandId: string;
  executable: string;
  args: string[];
  cwd: string;

  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;

  timedOut: boolean;
  cancelled: boolean;

  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  combinedOutputTruncated: boolean;
}
