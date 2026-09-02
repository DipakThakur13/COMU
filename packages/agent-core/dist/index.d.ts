import { AgentLimits, AgentEvent } from '@comu/protocol';
import { ModelProvider } from '@comu/model-core';
import { ToolRegistry, ToolExecutor } from '@comu/tool-core';
import { DiffEngine } from '@comu/diff-engine';

type AgentState = "IDLE" | "STARTING" | "THINKING" | "TOOL_CALLING" | "OBSERVING" | "COMPLETED" | "FAILED" | "CANCELLED" | "LIMIT_REACHED";
interface OrchestratorContext {
    taskId: string;
    workspaceRoot: string;
    systemPrompt: string;
    userPrompt: string;
    limits: AgentLimits;
    onEvent: (event: AgentEvent) => void;
    abortSignal?: AbortSignal;
}
interface AgentResult {
    status: "completed" | "failed" | "cancelled" | "limit_reached";
    finalText?: string;
    error?: string;
    steps: number;
    changeSet?: any;
}

declare class AgentOrchestrator {
    private model;
    private registry;
    private executor;
    private diffEngine;
    private state;
    constructor(model: ModelProvider, registry: ToolRegistry, executor: ToolExecutor, diffEngine: DiffEngine);
    private changeState;
    run(ctx: OrchestratorContext): Promise<AgentResult>;
}

export { AgentOrchestrator, type AgentResult, type AgentState, type OrchestratorContext };
