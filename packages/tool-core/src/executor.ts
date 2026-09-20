import { ToolRegistry } from "./registry.js";
import { ToolContext, ToolCapability } from "./interfaces.js";
import { ToolError, TimeoutError, TaskCancelledError, PermissionError } from "@comu/shared";

import { CanonicalToolCallParser } from "./parser.js";

export class ToolExecutor {
  private parser = new CanonicalToolCallParser();

  constructor(private registry: ToolRegistry) {}

  /**
   * Safe entrypoint for raw model tool calls.
   * Parses, validates against contract & capabilities, and executes.
   */
  async processModelToolCall(
    rawInput: any,
    validateContract: (toolName: string, capabilities: ToolCapability[]) => { valid: boolean; reason?: string },
    context: ToolContext
  ): Promise<any> {
    const parseResult = this.parser.parse(rawInput);

    if (parseResult.type === "text") {
      return { type: "text", content: parseResult.content };
    }

    if (parseResult.type === "malformed_tool_call") {
      return {
        type: "error",
        error: `MALFORMED_TOOL_CALL: ${parseResult.error}`,
        raw: parseResult.raw
      };
    }

    const toolCall = parseResult.call;
    context.onTrace?.("TOOL_REQUEST", toolCall.id);
    context.onTrace?.("VALIDATION_STARTED", toolCall.id);

    let tool;
    try {
      tool = this.registry.get(toolCall.name);
    } catch (e) {
      return { type: "error", error: `UNKNOWN_TOOL: ${toolCall.name}` };
    }

    // Contract validation provided by caller (AgentOrchestrator)
    const contractValidation = validateContract(tool.name, tool.capabilities);
    if (!contractValidation.valid) {
      return { type: "error", error: `CONTRACT_REJECTED: ${contractValidation.reason}` };
    }

    // Existing Capability validation
    if (context.permissions) {
      for (const capability of tool.capabilities) {
        const decision = context.permissions.capabilities[capability] || "DENY";
        if (decision !== "ALLOW") {
          return { type: "error", error: `PERMISSION_DENIED: requires '${capability}', but permission is ${decision}` };
        }
      }
    }

    context.onTrace?.("VALIDATION_COMPLETED", toolCall.id);

    // Execute
    try {
      context.onTrace?.("TOOL_STARTED", toolCall.id);
      const result = await this.execute(toolCall.name, toolCall.arguments, context);
      context.onTrace?.("TOOL_COMPLETED", toolCall.id);
      return { type: "success", result };
    } catch (e: any) {
      context.onTrace?.("TOOL_FAILED", toolCall.id);
      return { type: "error", error: `EXECUTION_FAILED: ${e.message}` };
    }
  }

  /**
   * Internal execution logic (bypasses model-specific parsing, assumes safe internal caller).
   *
   * Timeout semantics: when `context.limits.timeoutMs` elapses the call rejects with TimeoutError
   * AND the tool is told to stop through a derived AbortSignal / CancellationSignal on the context
   * it received. Tools that honour cancellation (terminal, validation) terminate their work;
   * a tool that ignores the signal cannot be stopped from outside, and its eventual settlement is
   * observed and discarded so it can never surface as an unhandled rejection.
   */
  async execute<TArgs, TResult>(
    toolName: string,
    args: TArgs,
    context: ToolContext
  ): Promise<TResult> {
    const tool = this.registry.get(toolName);
    if (!tool) throw new Error(`Unknown tool: ${toolName}`);

    if (context.cancellation?.isCancelled || context.abortSignal?.aborted) {
      throw new TaskCancelledError(`Execution of tool ${toolName} cancelled before start`);
    }

    if (context.permissions) {
      for (const capability of tool.capabilities) {
        const decision = context.permissions.capabilities[capability] || "DENY";
        if (decision !== "ALLOW") {
          throw new PermissionError(`Tool ${toolName} requires capability '${capability}', but permission is ${decision}`);
        }
      }
    }

    const timeoutMs = context.limits?.timeoutMs;
    if (!timeoutMs) {
      try {
        return await tool.execute(args, context);
      } catch (error) {
        throw ToolExecutor.normalizeError(error);
      }
    }

    // Derive a per-call cancellation scope: parent cancellation and the timeout both abort it.
    const scope = new AbortController();
    const abortScope = () => scope.abort();
    context.abortSignal?.addEventListener("abort", abortScope, { once: true });
    context.cancellation?.onCancel(abortScope);

    const scopedContext: ToolContext = {
      ...context,
      abortSignal: scope.signal,
      cancellation: {
        get isCancelled() {
          return scope.signal.aborted;
        },
        onCancel: (cb: () => void) => {
          if (scope.signal.aborted) {
            cb();
          } else {
            scope.signal.addEventListener("abort", cb, { once: true });
          }
        }
      }
    };

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        scope.abort();
        reject(new TimeoutError(`Tool ${toolName} execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const work = Promise.resolve().then(() => tool.execute(args, scopedContext));
    // If the timeout wins, the tool's own settlement is no longer observed by anyone.
    work.catch(() => {});

    try {
      return await Promise.race([work, timeout]);
    } catch (error) {
      throw ToolExecutor.normalizeError(error);
    } finally {
      if (timer) clearTimeout(timer);
      context.abortSignal?.removeEventListener("abort", abortScope);
    }
  }

  private static normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new ToolError(String(error));
  }
}
