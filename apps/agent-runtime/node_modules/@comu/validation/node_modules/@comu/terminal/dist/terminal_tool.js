"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalTool = void 0;
const policy_1 = require("./policy");
const process_manager_1 = require("./process_manager");
const output_sanitizer_1 = require("./output_sanitizer");
const path_1 = require("path");
class TerminalTool {
    name = "execute_command";
    description = "Executes a development command in the terminal. The command must be an approved safe development command (e.g. npm, tsc, python). Shell injection or arbitrary execution is prohibited. Do NOT use shell operators like && or >.";
    capabilities = ["execute"];
    inputSchema = {
        type: "object",
        properties: {
            executable: {
                type: "string",
                description: "The executable to run (e.g., 'npm', 'tsc', 'pytest')"
            },
            args: {
                type: "array",
                items: { type: "string" },
                description: "Arguments to pass to the executable"
            },
            cwd: {
                type: "string",
                description: "Working directory relative to the workspace root. Defaults to the root if omitted."
            }
        },
        required: ["executable", "args"]
    };
    policy = new policy_1.CommandPolicy();
    processManager = new process_manager_1.ProcessManager();
    async execute(args, context) {
        const rootPath = context.workspace.rootPath;
        let targetCwd = rootPath;
        if (args.cwd) {
            targetCwd = (0, path_1.isAbsolute)(args.cwd) ? args.cwd : (0, path_1.resolve)(rootPath, args.cwd);
        }
        // Workspace boundary check
        if (!(0, path_1.normalize)(targetCwd).startsWith((0, path_1.normalize)(rootPath))) {
            throw new Error(`WORKSPACE_BOUNDARY_VIOLATION: Cannot execute command outside of workspace root: ${rootPath}`);
        }
        const plan = {
            executable: args.executable,
            args: args.args,
            cwd: targetCwd,
            source: "AGENT"
        };
        const decision = this.policy.evaluate(plan);
        if (decision.decision !== "ALLOW") {
            throw new Error(`COMMAND_DENIED: ${decision.reason} (Category: ${decision.category})`);
        }
        // Set up AbortSignal from context cancellation
        const abortController = new AbortController();
        if (context.cancellation) {
            if (context.cancellation.isCancelled) {
                throw new Error("COMMAND_CANCELLED: Task was cancelled before command execution.");
            }
            context.cancellation.onCancel(() => {
                abortController.abort();
            });
        }
        const result = await this.processManager.start(plan, {
            timeoutMs: context.limits.maxCommandTimeoutMs || 30000, // 30 seconds default
            maxStdoutBytes: context.limits.maxStdoutBytes || 1024 * 1024,
            maxStderrBytes: context.limits.maxStderrBytes || 1024 * 1024,
            maxCombinedOutputBytes: context.limits.maxCombinedOutputBytes || 2 * 1024 * 1024,
            abortSignal: abortController.signal
        });
        if (result.timedOut) {
            throw new Error(`COMMAND_TIMEOUT: Process timed out. stdout: ${result.stdout} stderr: ${result.stderr}`);
        }
        if (result.cancelled) {
            throw new Error(`COMMAND_CANCELLED: Process was cancelled.`);
        }
        return output_sanitizer_1.OutputSanitizer.sanitizeResult(result);
    }
}
exports.TerminalTool = TerminalTool;
//# sourceMappingURL=terminal_tool.js.map