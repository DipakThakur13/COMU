import { AgentTool, ToolCapability, ToolContext } from '@comu/tool-core';
import { CommandPolicy, ProcessManager, OutputSanitizer } from '@comu/terminal';
import { ValidationResult, ValidationContext } from './types';
import { CommandResolver } from './command_resolver';

class BaseValidationTool implements AgentTool<any, ValidationResult> {
  name: string;
  description: string;
  capabilities: ToolCapability[] = ["execute"];
  inputSchema = { type: "object", properties: {} };
  private target: "test" | "build" | "lint" | "typecheck";
  
  private processManager = new ProcessManager();
  private policy = new CommandPolicy();

  constructor(name: string, description: string, target: "test" | "build" | "lint" | "typecheck") {
    this.name = name;
    this.description = description;
    this.target = target;
  }

  async execute(args: any, context: ToolContext): Promise<ValidationResult> {
    const cwd = context.workspace.rootPath;
    const vContext: ValidationContext = { cwd, target: this.target };

    const plan = CommandResolver.resolve(vContext);
    
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

    const sanitized = OutputSanitizer.sanitizeResult(result);

    let status: ValidationResult["status"] = "PASS";
    if (sanitized.cancelled) status = "CANCELLED";
    else if (sanitized.timedOut) status = "TIMEOUT";
    else if (sanitized.exitCode !== 0) status = "FAIL";

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

  private createResult(code: number | null, status: ValidationResult["status"], durationMs: number, outputTruncated: boolean): ValidationResult {
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

export class RunTestsTool extends BaseValidationTool {
  constructor() {
    super("run_tests", "Run the project's test suite and return structured validation results.", "test");
  }
}

export class RunBuildTool extends BaseValidationTool {
  constructor() {
    super("run_build", "Run the project's build process.", "build");
  }
}

export class RunLinterTool extends BaseValidationTool {
  constructor() {
    super("run_linter", "Run the project's linter.", "lint");
  }
}

export class RunTypecheckTool extends BaseValidationTool {
  constructor() {
    super("run_typecheck", "Run the project's typechecker (e.g. tsc).", "typecheck");
  }
}
