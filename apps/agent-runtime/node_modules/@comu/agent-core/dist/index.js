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
  AgentOrchestrator: () => AgentOrchestrator
});
module.exports = __toCommonJS(index_exports);

// src/orchestrator.ts
var AgentOrchestrator = class {
  constructor(model, registry, executor, diffEngine) {
    this.model = model;
    this.registry = registry;
    this.executor = executor;
    this.diffEngine = diffEngine;
  }
  model;
  registry;
  executor;
  diffEngine;
  state = "IDLE";
  changeState(ctx, newState, message) {
    this.state = newState;
    ctx.onEvent({
      type: "agent.status",
      eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2)}`,
      taskId: ctx.taskId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      status: message || newState
    });
  }
  async run(ctx) {
    const startTime = Date.now();
    let steps = 0;
    let toolCallsCount = 0;
    ctx.onEvent({
      type: "task.started",
      eventId: `evt-${Date.now()}`,
      taskId: ctx.taskId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    this.changeState(ctx, "STARTING", "Initializing task");
    const changeSet = this.diffEngine.createChangeSet(ctx.taskId);
    const messages = [
      { role: "user", content: ctx.userPrompt }
    ];
    const tools = this.registry.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }));
    while (true) {
      if (ctx.abortSignal?.aborted) {
        this.changeState(ctx, "CANCELLED", "Task was cancelled");
        ctx.onEvent({ type: "task.cancelled", eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
        return { status: "cancelled", steps, changeSet };
      }
      if (steps >= ctx.limits.maxSteps) {
        this.changeState(ctx, "LIMIT_REACHED", `Max steps (${ctx.limits.maxSteps}) reached`);
        ctx.onEvent({ type: "agent.limit_reached", limit: "maxSteps", eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
        return { status: "limit_reached", steps, changeSet };
      }
      if (Date.now() - startTime > ctx.limits.maxExecutionTimeMs) {
        this.changeState(ctx, "LIMIT_REACHED", `Max execution time reached`);
        ctx.onEvent({ type: "agent.limit_reached", limit: "maxExecutionTimeMs", eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
        return { status: "limit_reached", steps, changeSet };
      }
      this.changeState(ctx, "THINKING", "Thinking...");
      steps++;
      let response;
      try {
        response = await this.model.generate({
          prompt: ctx.userPrompt,
          systemPrompt: ctx.systemPrompt,
          messages,
          tools
        });
      } catch (err) {
        this.changeState(ctx, "FAILED", `Provider Error: ${err.message}`);
        ctx.onEvent({ type: "task.failed", error: err.message, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
        return { status: "failed", error: err.message, steps, changeSet };
      }
      messages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls
      });
      if (!response.toolCalls || response.toolCalls.length === 0) {
        this.changeState(ctx, "COMPLETED", "Task completed");
        ctx.onEvent({ type: "task.completed", eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
        return { status: "completed", finalText: response.text, steps, changeSet };
      }
      this.changeState(ctx, "TOOL_CALLING", "Executing tools...");
      for (const tc of response.toolCalls) {
        toolCallsCount++;
        if (toolCallsCount > ctx.limits.maxToolCalls) {
          this.changeState(ctx, "LIMIT_REACHED", `Max tool calls (${ctx.limits.maxToolCalls}) reached`);
          ctx.onEvent({ type: "agent.limit_reached", limit: "maxToolCalls", eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
          return { status: "limit_reached", steps, changeSet };
        }
        ctx.onEvent({ type: "tool.started", tool: tc.name, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
        let toolResultStr = "";
        try {
          const tCtx = {
            taskId: ctx.taskId,
            workspace: { rootPath: ctx.workspaceRoot },
            limits: { maxResults: 100, maxBytes: 1e6 },
            permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "DENY" } }
          };
          const isMutating = tc.name === "create_file" || tc.name === "write_file" || tc.name === "edit_file";
          let baselineContent;
          let baselineHash;
          let baselineExists = false;
          if (isMutating) {
            const targetPath = tc.arguments.path;
            const existingRecord = changeSet.changes.get(targetPath);
            if (!existingRecord || existingRecord.originalContent === void 0) {
              try {
                const readRes = await this.executor.execute("read_file", { path: targetPath }, tCtx);
                baselineContent = readRes.content;
                baselineHash = readRes.hash;
                baselineExists = true;
              } catch (e) {
                baselineExists = false;
              }
            } else {
              baselineContent = existingRecord.originalContent;
              baselineHash = existingRecord.originalHash;
              baselineExists = true;
            }
          }
          let toolError = null;
          let result;
          try {
            result = await this.executor.execute(tc.name, tc.arguments, tCtx);
          } catch (e) {
            toolError = e;
          }
          if (isMutating) {
            const targetPath = tc.arguments.path;
            let finalContent;
            let finalHash;
            let finalExists = false;
            let readError = null;
            try {
              const readRes = await this.executor.execute("read_file", { path: targetPath }, tCtx);
              finalContent = readRes.content;
              finalHash = readRes.hash;
              finalExists = true;
            } catch (e) {
              readError = e;
              finalExists = false;
            }
            if (toolError) {
              const changed = baselineExists !== finalExists || baselineHash !== finalHash;
              if (changed) {
                if (readError && !baselineExists && !finalExists && baselineHash === finalHash) {
                }
                if (readError && !baselineExists) {
                  this.changeState(ctx, "FAILED", `Mutation failed and workspace state cannot be verified.`);
                  ctx.onEvent({ type: "task.failed", error: "Workspace state unknown", payload: { code: "WORKSPACE_STATE_UNKNOWN", message: "Failed to verify state after tool error" }, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
                  return { status: "failed", error: "WORKSPACE_STATE_UNKNOWN", steps, changeSet };
                } else {
                  this.changeState(ctx, "FAILED", `Integrity Error: Workspace mutated despite tool failure`);
                  ctx.onEvent({ type: "task.failed", error: "Workspace state changed after failure", payload: { code: "WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE", message: toolError.message }, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
                  return { status: "failed", error: "WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE", steps, changeSet };
                }
              }
              throw toolError;
            } else {
              try {
                const operation = tc.name === "create_file" && !baselineExists ? "CREATE" : "MODIFY";
                this.diffEngine.recordChange(changeSet, targetPath, operation, finalContent || tc.arguments.content || "edited", baselineContent, baselineHash, finalHash);
                ctx.onEvent({ type: "change.created", path: targetPath, operation, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
              } catch (recordError) {
                this.changeState(ctx, "FAILED", `Integrity Error: Change tracking failed`);
                ctx.onEvent({ type: "task.failed", error: recordError.message, payload: { code: "CHANGE_TRACKING_INTEGRITY_FAILURE", message: recordError.message }, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
                return { status: "failed", error: "CHANGE_TRACKING_INTEGRITY_FAILURE", steps, changeSet };
              }
            }
          } else if (toolError) {
            throw toolError;
          }
          toolResultStr = typeof result === "string" ? result : JSON.stringify(result);
          ctx.onEvent({ type: "tool.completed", tool: tc.name, result, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
        } catch (e) {
          toolResultStr = `ERROR: ${e.message}`;
          ctx.onEvent({ type: "tool.completed", tool: tc.name, result: { error: e.message }, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
        }
        messages.push({
          role: "tool",
          content: toolResultStr,
          toolCallId: tc.id
        });
      }
      this.changeState(ctx, "OBSERVING", "Observing results");
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AgentOrchestrator
});
