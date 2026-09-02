import { AgentState, OrchestratorContext, AgentResult } from "./interfaces.js";
import { ModelProvider, ModelMessage, ToolDefinition } from "@comu/model-core";
import { ToolExecutor, ToolRegistry, ToolContext } from "@comu/tool-core";
import { DiffEngine } from "@comu/diff-engine";

export class AgentOrchestrator {
  private state: AgentState = "IDLE";
  
  constructor(
    private model: ModelProvider,
    private registry: ToolRegistry,
    private executor: ToolExecutor,
    private diffEngine: DiffEngine
  ) {}

  private changeState(ctx: OrchestratorContext, newState: AgentState, message?: string) {
    this.state = newState;
    ctx.onEvent({
      type: "agent.status",
      eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2)}`,
      taskId: ctx.taskId,
      timestamp: new Date().toISOString(),
      status: message || newState
    });
  }

  async run(ctx: OrchestratorContext): Promise<AgentResult> {
    const startTime = Date.now();
    let steps = 0;
    let toolCallsCount = 0;
    
    ctx.onEvent({
      type: "task.started",
      eventId: `evt-${Date.now()}`,
      taskId: ctx.taskId,
      timestamp: new Date().toISOString()
    });
    
    this.changeState(ctx, "STARTING", "Initializing task");

    const changeSet = this.diffEngine.createChangeSet(ctx.taskId);
    
    const messages: ModelMessage[] = [
      { role: "user", content: ctx.userPrompt }
    ];

    const tools: ToolDefinition[] = this.registry.getAll().map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }));

    while (true) {
      if (ctx.abortSignal?.aborted) {
        this.changeState(ctx, "CANCELLED", "Task was cancelled");
        ctx.onEvent({ type: "task.cancelled", eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: new Date().toISOString() });
        return { status: "cancelled", steps, changeSet };
      }

      if (steps >= ctx.limits.maxSteps) {
        this.changeState(ctx, "LIMIT_REACHED", `Max steps (${ctx.limits.maxSteps}) reached`);
        ctx.onEvent({ type: "agent.limit_reached", limit: "maxSteps", eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: new Date().toISOString() });
        return { status: "limit_reached", steps, changeSet };
      }
      if (Date.now() - startTime > ctx.limits.maxExecutionTimeMs) {
        this.changeState(ctx, "LIMIT_REACHED", `Max execution time reached`);
        ctx.onEvent({ type: "agent.limit_reached", limit: "maxExecutionTimeMs", eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: new Date().toISOString() });
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
      } catch (err: any) {
        this.changeState(ctx, "FAILED", `Provider Error: ${err.message}`);
        ctx.onEvent({ type: "task.failed", error: err.message, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: new Date().toISOString() });
        return { status: "failed", error: err.message, steps, changeSet };
      }

      messages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls
      });

      if (!response.toolCalls || response.toolCalls.length === 0) {
        this.changeState(ctx, "COMPLETED", "Task completed");
        ctx.onEvent({ type: "task.completed", eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: new Date().toISOString() });
        return { status: "completed", finalText: response.text, steps, changeSet };
      }

      this.changeState(ctx, "TOOL_CALLING", "Executing tools...");

      for (const tc of response.toolCalls) {
        toolCallsCount++;
        if (toolCallsCount > ctx.limits.maxToolCalls) {
           this.changeState(ctx, "LIMIT_REACHED", `Max tool calls (${ctx.limits.maxToolCalls}) reached`);
           ctx.onEvent({ type: "agent.limit_reached", limit: "maxToolCalls", eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: new Date().toISOString() });
           return { status: "limit_reached", steps, changeSet };
        }

        ctx.onEvent({ type: "tool.started", tool: tc.name, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: new Date().toISOString() });
        
        let toolResultStr = "";
        try {
          const tCtx: ToolContext = {
            taskId: ctx.taskId,
            workspace: { rootPath: ctx.workspaceRoot },
            limits: { maxResults: 100, maxBytes: 1000000 },
            permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "DENY" } }
          };

          const isMutating = tc.name === "create_file" || tc.name === "write_file" || tc.name === "edit_file";
          let baselineContent: string | undefined;
          let baselineHash: string | undefined;
          let baselineExists = false;
          
          if (isMutating) {
             const targetPath = tc.arguments.path as string;
             const existingRecord = changeSet.changes.get(targetPath);
             
             if (!existingRecord || existingRecord.originalContent === undefined) {
                 try {
                     const readRes = await this.executor.execute("read_file", { path: targetPath }, tCtx) as any;
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

          let toolError: any = null;
          let result: any;
          try {
             result = await this.executor.execute(tc.name, tc.arguments, tCtx);
          } catch(e) {
             toolError = e;
          }

          if (isMutating) {
             const targetPath = tc.arguments.path as string;
             let finalContent: string | undefined;
             let finalHash: string | undefined;
             let finalExists = false;
             let readError: any = null;
             
             try {
                const readRes = await this.executor.execute("read_file", { path: targetPath }, tCtx) as any;
                finalContent = readRes.content;
                finalHash = readRes.hash;
                finalExists = true;
             } catch (e) {
                readError = e;
                finalExists = false;
             }

             if (toolError) {
                 const changed = (baselineExists !== finalExists) || (baselineHash !== finalHash);
                 if (changed) {
                     if (readError && !baselineExists && !finalExists && baselineHash === finalHash) {
                         // False positive on error parsing
                     }
                     if (readError && !baselineExists) {
                         this.changeState(ctx, "FAILED", `Mutation failed and workspace state cannot be verified.`);
                         ctx.onEvent({ type: "task.failed", error: "Workspace state unknown", payload: { code: "WORKSPACE_STATE_UNKNOWN", message: "Failed to verify state after tool error" }, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: new Date().toISOString() });
                         return { status: "failed", error: "WORKSPACE_STATE_UNKNOWN", steps, changeSet };
                     } else {
                         this.changeState(ctx, "FAILED", `Integrity Error: Workspace mutated despite tool failure`);
                         ctx.onEvent({ type: "task.failed", error: "Workspace state changed after failure", payload: { code: "WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE", message: toolError.message }, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: new Date().toISOString() });
                         return { status: "failed", error: "WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE", steps, changeSet };
                     }
                 }
                 throw toolError;
             } else {
                 try {
                     const operation = (tc.name === "create_file" && !baselineExists) ? "CREATE" : "MODIFY";
                     this.diffEngine.recordChange(changeSet, targetPath, operation, finalContent || tc.arguments.content || "edited", baselineContent, baselineHash, finalHash);
                     ctx.onEvent({ type: "change.created", path: targetPath, operation, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: new Date().toISOString() });
                 } catch (recordError: any) {
                     this.changeState(ctx, "FAILED", `Integrity Error: Change tracking failed`);
                     ctx.onEvent({ type: "task.failed", error: recordError.message, payload: { code: "CHANGE_TRACKING_INTEGRITY_FAILURE", message: recordError.message }, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: new Date().toISOString() });
                     return { status: "failed", error: "CHANGE_TRACKING_INTEGRITY_FAILURE", steps, changeSet };
                 }
             }
          } else if (toolError) {
             throw toolError;
          }
          
          toolResultStr = typeof result === "string" ? result : JSON.stringify(result);
          ctx.onEvent({ type: "tool.completed", tool: tc.name, result, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: new Date().toISOString() });

        } catch (e: any) {
          toolResultStr = `ERROR: ${e.message}`;
          ctx.onEvent({ type: "tool.completed", tool: tc.name, result: { error: e.message }, eventId: `evt-${Date.now()}`, taskId: ctx.taskId, timestamp: new Date().toISOString() });
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
}
