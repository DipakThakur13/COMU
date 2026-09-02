export type CommandCategory = "SAFE_DEVELOPMENT" | "RESTRICTED" | "DESTRUCTIVE" | "NETWORK" | "UNKNOWN";
export type CommandSource = "AGENT" | "VALIDATION" | "EXTENSION";
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
//# sourceMappingURL=command_plan.d.ts.map