import {
  SubagentTask,
  SubagentResult,
  SubagentType,
  SubagentStatus,
  AgentEvent
} from "@comu/protocol";
import { ToolRegistry, ToolExecutor, ToolContext } from "@comu/tool-core";
import { ModelProvider, ModelMessage, ToolDefinition } from "@comu/model-core";

export interface SubagentManagerOptions {
  maxSubagentsPerTask?: number;
  maxSubagentDepth?: number;
  maxTotalSubagentSteps?: number;
}

export class SubagentManager {
  private activeSubagents = new Map<string, { task: SubagentTask; controller: AbortController }>();
  private subagentsPerTask = new Map<string, number>();
  private totalStepsPerTask = new Map<string, number>();

  private maxSubagentsPerTask: number;
  private maxSubagentDepth: number;
  private maxTotalSubagentSteps: number;

  constructor(options?: SubagentManagerOptions) {
    this.maxSubagentsPerTask = options?.maxSubagentsPerTask || 2;
    this.maxSubagentDepth = options?.maxSubagentDepth || 1;
    this.maxTotalSubagentSteps = options?.maxTotalSubagentSteps || 10;
  }

  public static getWorkerCapabilities(type: SubagentType): { allowedTools: string[]; allowedCapabilities: string[] } {
    switch (type) {
      case "RESEARCH":
        return {
          allowedTools: ["read_file", "list_directory", "search_text", "get_workspace_tree", "web_docs"],
          allowedCapabilities: ["read", "execute"]
        };
      case "VERIFICATION":
        return {
          allowedTools: [
            "read_file",
            "list_directory",
            "run_tests",
            "run_build",
            "run_linter",
            "run_typecheck",
            "git_status",
            "git_diff"
          ],
          allowedCapabilities: ["read", "execute"]
        };
    }
  }

  public async executeSubagent(params: {
    parentTaskId: string;
    type: SubagentType;
    depth: number;
    goal: string;
    parentSignal?: AbortSignal;
    model: ModelProvider;
    registry: ToolRegistry;
    executor: ToolExecutor;
    toolContext: ToolContext;
    onEvent: (event: AgentEvent) => void;
  }): Promise<SubagentResult> {
    const startTime = Date.now();

    // 1. Invariant: Strict Depth Limit = 1 (No recursive subagents)
    if (params.depth > this.maxSubagentDepth) {
      const err = `FORBIDDEN_RECURSIVE_SUBAGENT: Subagent depth (${params.depth}) exceeds maximum allowed depth (${this.maxSubagentDepth}).`;
      return {
        subagentId: `err-${Date.now()}`,
        parentTaskId: params.parentTaskId,
        type: params.type,
        status: "FAILED",
        summary: err,
        usage: { steps: 0, toolCalls: 0, durationMs: 0 },
        error: err
      };
    }

    // 2. Invariant: Max Subagents Per Task Limit
    const currentCount = this.subagentsPerTask.get(params.parentTaskId) || 0;
    if (currentCount >= this.maxSubagentsPerTask) {
      const err = `SUBAGENT_LIMIT_REACHED: Task has already spawned maximum allowed subagents (${this.maxSubagentsPerTask}).`;
      return {
        subagentId: `err-${Date.now()}`,
        parentTaskId: params.parentTaskId,
        type: params.type,
        status: "LIMIT_REACHED",
        summary: err,
        usage: { steps: 0, toolCalls: 0, durationMs: 0 },
        error: err
      };
    }

    const subagentId = `sub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.subagentsPerTask.set(params.parentTaskId, currentCount + 1);

    const controller = new AbortController();
    if (params.parentSignal) {
      if (params.parentSignal.aborted) {
        controller.abort();
      } else {
        params.parentSignal.addEventListener("abort", () => controller.abort());
      }
    }

    const subagentTask: SubagentTask = {
      subagentId,
      parentTaskId: params.parentTaskId,
      type: params.type,
      depth: 1,
      goal: params.goal,
      budget: {
        maxSteps: 5,
        maxToolCalls: 5,
        maxExecutionTimeMs: 30000,
        maxOutputBytes: 100000
      },
      capabilities: SubagentManager.getWorkerCapabilities(params.type).allowedCapabilities
    };

    this.activeSubagents.set(subagentId, { task: subagentTask, controller });

    params.onEvent({
      type: "subagent.started",
      eventId: `evt-${Date.now()}`,
      taskId: params.parentTaskId,
      timestamp: new Date().toISOString(),
      subagentId,
      subagentType: params.type,
      goal: params.goal
    });

    const allowed = SubagentManager.getWorkerCapabilities(params.type);
    const workerTools: ToolDefinition[] = params.registry
      .getAll()
      .filter(t => allowed.allowedTools.includes(t.name))
      .map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }));

    let steps = 0;
    let toolCalls = 0;
    const findings: string[] = [];
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: `You are a specialized ${params.type} worker agent. Your goal: "${params.goal}". You are strictly READ-ONLY. You cannot write files or modify git. Perform your investigation and provide a concise summary.`
      }
    ];

    try {
      while (steps < subagentTask.budget.maxSteps) {
        if (controller.signal.aborted) {
          params.onEvent({
            type: "subagent.cancelled",
            eventId: `evt-${Date.now()}`,
            taskId: params.parentTaskId,
            timestamp: new Date().toISOString(),
            subagentId,
            subagentType: params.type
          });
          return {
            subagentId,
            parentTaskId: params.parentTaskId,
            type: params.type,
            status: "CANCELLED",
            summary: "Worker was cancelled.",
            usage: { steps, toolCalls, durationMs: Date.now() - startTime }
          };
        }

        steps++;
        const currentTaskTotalSteps = (this.totalStepsPerTask.get(params.parentTaskId) || 0) + 1;
        this.totalStepsPerTask.set(params.parentTaskId, currentTaskTotalSteps);

        if (currentTaskTotalSteps > this.maxTotalSubagentSteps) {
          const limitErr = `TOTAL_SUBAGENT_STEPS_EXCEEDED: Exceeded max cumulative subagent steps (${this.maxTotalSubagentSteps}).`;
          return {
            subagentId,
            parentTaskId: params.parentTaskId,
            type: params.type,
            status: "LIMIT_REACHED",
            summary: limitErr,
            usage: { steps, toolCalls, durationMs: Date.now() - startTime },
            error: limitErr
          };
        }

        const response = await params.model.generate({
          prompt: params.goal,
          systemPrompt: `You are a bounded ${params.type} subagent. Execute read-only tools or provide findings.`,
          messages,
          tools: workerTools
        });

        messages.push({
          role: "assistant",
          content: response.text,
          toolCalls: response.toolCalls
        });

        if (response.text) {
          findings.push(response.text);
        }

        // If no tool calls, worker finished
        if (!response.toolCalls || response.toolCalls.length === 0) {
          break;
        }

        // Execute tool calls
        for (const tc of response.toolCalls) {
          toolCalls++;
          if (toolCalls > subagentTask.budget.maxToolCalls) {
            break;
          }

          // Safety invariant: Worker tool must be explicitly permitted
          if (!allowed.allowedTools.includes(tc.name)) {
            const forbiddenMsg = `CAPABILITY_DENIED: Tool '${tc.name}' is strictly forbidden for ${params.type} worker agent.`;
            messages.push({
              role: "tool",
              content: forbiddenMsg,
              toolCallId: tc.id
            });
            continue;
          }

          let toolResult: any;
          try {
            toolResult = await params.executor.execute(tc.name, tc.arguments, params.toolContext);
          } catch (e: any) {
            toolResult = { error: e.message };
          }

          messages.push({
            role: "tool",
            content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
            toolCallId: tc.id
          });
        }
      }

      const result: SubagentResult = {
        subagentId,
        parentTaskId: params.parentTaskId,
        type: params.type,
        status: "COMPLETED",
        summary: findings[findings.length - 1] || "Investigation completed.",
        findings,
        usage: {
          steps,
          toolCalls,
          durationMs: Date.now() - startTime
        }
      };

      params.onEvent({
        type: "subagent.completed",
        eventId: `evt-${Date.now()}`,
        taskId: params.parentTaskId,
        timestamp: new Date().toISOString(),
        subagentId,
        subagentType: params.type,
        result
      });

      return result;
    } catch (err: any) {
      const failResult: SubagentResult = {
        subagentId,
        parentTaskId: params.parentTaskId,
        type: params.type,
        status: "FAILED",
        summary: `Worker failed: ${err.message}`,
        error: err.message,
        usage: {
          steps,
          toolCalls,
          durationMs: Date.now() - startTime
        }
      };

      params.onEvent({
        type: "subagent.failed",
        eventId: `evt-${Date.now()}`,
        taskId: params.parentTaskId,
        timestamp: new Date().toISOString(),
        subagentId,
        subagentType: params.type,
        error: err.message
      });

      return failResult;
    } finally {
      this.activeSubagents.delete(subagentId);
    }
  }

  public cancelSubagentsForTask(parentTaskId: string): void {
    for (const [subId, entry] of this.activeSubagents.entries()) {
      if (entry.task.parentTaskId === parentTaskId) {
        entry.controller.abort();
        this.activeSubagents.delete(subId);
      }
    }
  }

  public getActiveSubagents(parentTaskId?: string): SubagentTask[] {
    const list: SubagentTask[] = [];
    for (const entry of this.activeSubagents.values()) {
      if (!parentTaskId || entry.task.parentTaskId === parentTaskId) {
        list.push(entry.task);
      }
    }
    return list;
  }
}
