"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  ToolExecutor: () => ToolExecutor,
  ToolRegistry: () => ToolRegistry
});
module.exports = __toCommonJS(index_exports);

// src/registry.ts
var import_shared = require("@comu/shared");
var ToolRegistry = class {
  tools = /* @__PURE__ */ new Map();
  register(tool) {
    if (this.tools.has(tool.name)) {
      throw new import_shared.ToolError(`Tool ${tool.name} is already registered`);
    }
    this.tools.set(tool.name, tool);
  }
  get(name) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new import_shared.ToolError(`Tool ${name} not found`);
    }
    return tool;
  }
  getAll() {
    return Array.from(this.tools.values());
  }
};

// src/executor.ts
var import_shared2 = require("@comu/shared");
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
          throw new import_shared2.TaskCancelledError(`Execution of tool ${toolName} cancelled before start`);
        }
        if (context.permissions) {
          for (const capability of tool.capabilities) {
            const decision = context.permissions.capabilities[capability] || "DENY";
            if (decision !== "ALLOW") {
              throw new import_shared2.PermissionError(`Tool ${toolName} requires capability '${capability}', but permission is ${decision}`);
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
          reject(new import_shared2.TimeoutError(`Tool ${toolName} execution timed out after ${context.limits.timeoutMs}ms`));
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
      throw new import_shared2.ToolError(String(error));
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ToolExecutor,
  ToolRegistry
});
