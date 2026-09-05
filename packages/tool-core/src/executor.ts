import { ToolRegistry } from "./registry.js";
import { ToolContext, CancellationSignal, PermissionDecision, ToolCapability } from "./interfaces.js";
import { ToolError, TimeoutError, TaskCancelledError, PermissionError } from "@comu/shared";

import { CanonicalToolCallParser, ToolParseResult } from "./parser.js";

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
   */
  async execute<TArgs, TResult>(
    toolName: string,
    args: TArgs,
    context: ToolContext
  ): Promise<TResult> {
    const tool = this.registry.get(toolName);
    if (!tool) throw new Error(`Unknown tool: ${toolName}`);

    // Simple timeout mechanism if limits.timeoutMs is provided
    let timeoutId: NodeJS.Timeout | undefined;
    let isTimedOut = false;

    const executePromise = new Promise<TResult>(async (resolve, reject) => {
      try {
        if (context.cancellation?.isCancelled) {
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

        const result = await tool.execute(args, context);
        
        if (isTimedOut) return;
        resolve(result);
      } catch (error) {
        if (isTimedOut) return;
        reject(error);
      }
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      if (context.limits?.timeoutMs) {
        timeoutId = setTimeout(() => {
          isTimedOut = true;
          reject(new TimeoutError(`Tool ${toolName} execution timed out after ${context.limits.timeoutMs}ms`));
        }, context.limits.timeoutMs);
      }
    });

    try {
      const result = await Promise.race([
        executePromise,
        ...(context.limits?.timeoutMs ? [timeoutPromise] : [])
      ]);
      return result;
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new ToolError(String(error));
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}
