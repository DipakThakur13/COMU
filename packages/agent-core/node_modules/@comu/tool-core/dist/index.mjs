// src/registry.ts
import { ToolError } from "@comu/shared";
var ToolRegistry = class {
  tools = /* @__PURE__ */ new Map();
  register(tool) {
    if (this.tools.has(tool.name)) {
      throw new ToolError(`Tool ${tool.name} is already registered`);
    }
    this.tools.set(tool.name, tool);
  }
  get(name) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolError(`Tool ${name} not found`);
    }
    return tool;
  }
  getAll() {
    return Array.from(this.tools.values());
  }
};

// src/executor.ts
import { ToolError as ToolError2, TimeoutError, TaskCancelledError, PermissionError } from "@comu/shared";
var ToolExecutor = class {
  constructor(registry) {
    this.registry = registry;
  }
  registry;
  async execute(toolName, args, context) {
    const tool = this.registry.get(toolName);
    let timeoutId;
    let isTimedOut = false;
    const executePromise = new Promise(async (resolve, reject) => {
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
    const timeoutPromise = new Promise((_, reject) => {
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
        ...context.limits?.timeoutMs ? [timeoutPromise] : []
      ]);
      return result;
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new ToolError2(String(error));
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
};
export {
  ToolExecutor,
  ToolRegistry
};
