import { ToolRegistry } from "./registry.js";
import { ToolContext, CancellationSignal, PermissionDecision } from "./interfaces.js";
import { ToolError, TimeoutError, TaskCancelledError, PermissionError } from "@comu/shared";

export class ToolExecutor {
  constructor(private registry: ToolRegistry) {}

  async execute<TArgs, TResult>(
    toolName: string,
    args: TArgs,
    context: ToolContext
  ): Promise<TResult> {
    const tool = this.registry.get(toolName);

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
