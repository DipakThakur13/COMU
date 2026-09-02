"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunTypecheckTool = exports.RunLinterTool = exports.RunBuildTool = exports.RunTestsTool = void 0;
const terminal_1 = require("@comu/terminal");
const command_resolver_1 = require("./command_resolver");
class BaseValidationTool {
    name;
    description;
    capabilities = ["execute"];
    inputSchema = { type: "object", properties: {} };
    target;
    processManager = new terminal_1.ProcessManager();
    policy = new terminal_1.CommandPolicy();
    constructor(name, description, target) {
        this.name = name;
        this.description = description;
        this.target = target;
    }
    async execute(args, context) {
        const cwd = context.workspace.rootPath;
        const vContext = { cwd, target: this.target };
        const plan = command_resolver_1.CommandResolver.resolve(vContext);
        if (!plan) {
            return {
                validatorId: this.name,
                name: this.target,
                status: "UNAVAILABLE",
                exitCode: null,
                stdout: "",
                stderr: "",
                durationMs: 0,
                outputTruncated: false
            };
        }
        const decision = this.policy.evaluate(plan);
        if (decision.decision !== "ALLOW") {
            throw new Error(`COMMAND_DENIED: Validation command denied by policy. Reason: ${decision.reason}`);
        }
        const abortController = new AbortController();
        if (context.cancellation) {
            if (context.cancellation.isCancelled) {
                return this.createResult(null, "CANCELLED", 0, false);
            }
            context.cancellation.onCancel(() => abortController.abort());
        }
        const result = await this.processManager.start(plan, {
            timeoutMs: context.limits.maxCommandTimeoutMs || 60000,
            maxStdoutBytes: context.limits.maxStdoutBytes || 512 * 1024,
            maxStderrBytes: context.limits.maxStderrBytes || 512 * 1024,
            maxCombinedOutputBytes: context.limits.maxCombinedOutputBytes || 1024 * 1024,
            abortSignal: abortController.signal
        });
        const sanitized = terminal_1.OutputSanitizer.sanitizeResult(result);
        let status = "PASS";
        if (sanitized.cancelled)
            status = "CANCELLED";
        else if (sanitized.timedOut)
            status = "TIMEOUT";
        else if (sanitized.exitCode !== 0)
            status = "FAIL";
        return {
            validatorId: this.name,
            name: this.target,
            status,
            exitCode: sanitized.exitCode,
            stdout: sanitized.stdout,
            stderr: sanitized.stderr,
            durationMs: sanitized.durationMs,
            outputTruncated: sanitized.combinedOutputTruncated || sanitized.stdoutTruncated || sanitized.stderrTruncated
        };
    }
    createResult(code, status, durationMs, outputTruncated) {
        return {
            validatorId: this.name,
            name: this.target,
            status,
            exitCode: code,
            stdout: "",
            stderr: "",
            durationMs,
            outputTruncated
        };
    }
}
class RunTestsTool extends BaseValidationTool {
    constructor() {
        super("run_tests", "Run the project's test suite and return structured validation results.", "test");
    }
}
exports.RunTestsTool = RunTestsTool;
class RunBuildTool extends BaseValidationTool {
    constructor() {
        super("run_build", "Run the project's build process.", "build");
    }
}
exports.RunBuildTool = RunBuildTool;
class RunLinterTool extends BaseValidationTool {
    constructor() {
        super("run_linter", "Run the project's linter.", "lint");
    }
}
exports.RunLinterTool = RunLinterTool;
class RunTypecheckTool extends BaseValidationTool {
    constructor() {
        super("run_typecheck", "Run the project's typechecker (e.g. tsc).", "typecheck");
    }
}
exports.RunTypecheckTool = RunTypecheckTool;
//# sourceMappingURL=validation_tools.js.map