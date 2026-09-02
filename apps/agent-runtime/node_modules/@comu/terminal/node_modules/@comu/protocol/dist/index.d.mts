interface SelectionContext {
    filePath: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
    text: string;
}
interface TaskRequest {
    taskId: string;
    prompt: string;
    modelId: string;
    workspace: {
        rootPath: string;
        workspaceId?: string;
    };
    editor?: {
        activeFile?: string;
        openFiles?: string[];
        selection?: SelectionContext;
    };
}
interface AgentEventBase {
    type: string;
    eventId: string;
    taskId: string;
    timestamp: string;
}
interface TaskStartedEvent extends AgentEventBase {
    type: "task.started";
}
interface AgentStatusEvent extends AgentEventBase {
    type: "agent.status";
    status: string;
}
interface ToolStartedEvent extends AgentEventBase {
    type: "tool.started";
    tool: string;
}
interface ToolCompletedEvent extends AgentEventBase {
    type: "tool.completed";
    tool: string;
    result?: any;
}
interface ChangeCreatedEvent extends AgentEventBase {
    type: "change.created";
    path: string;
    operation: "CREATE" | "MODIFY";
}
interface TaskCompletedEvent extends AgentEventBase {
    type: "task.completed";
}
interface TaskFailedEvent extends AgentEventBase {
    type: "task.failed";
    error: string;
    payload?: {
        code: string;
        message: string;
    };
}
interface TaskCancelledEvent extends AgentEventBase {
    type: "task.cancelled";
}
interface AgentLimitReachedEvent extends AgentEventBase {
    type: "agent.limit_reached";
    limit: string;
}
interface CommandStartedEvent extends AgentEventBase {
    type: "command.started";
    commandId: string;
}
interface CommandCompletedEvent extends AgentEventBase {
    type: "command.completed";
    commandId: string;
}
interface CommandFailedEvent extends AgentEventBase {
    type: "command.failed";
    commandId: string;
}
interface CommandTimeoutEvent extends AgentEventBase {
    type: "command.timeout";
    commandId: string;
}
interface CommandCancelledEvent extends AgentEventBase {
    type: "command.cancelled";
    commandId: string;
}
type AgentEvent = TaskStartedEvent | AgentStatusEvent | ToolStartedEvent | ToolCompletedEvent | ChangeCreatedEvent | TaskCompletedEvent | TaskFailedEvent | TaskCancelledEvent | AgentLimitReachedEvent | CommandStartedEvent | CommandCompletedEvent | CommandFailedEvent | CommandTimeoutEvent | CommandCancelledEvent;
interface AgentLimits {
    maxSteps: number;
    maxToolCalls: number;
    maxExecutionTimeMs: number;
}

export type { AgentEvent, AgentEventBase, AgentLimitReachedEvent, AgentLimits, AgentStatusEvent, ChangeCreatedEvent, CommandCancelledEvent, CommandCompletedEvent, CommandFailedEvent, CommandStartedEvent, CommandTimeoutEvent, SelectionContext, TaskCancelledEvent, TaskCompletedEvent, TaskFailedEvent, TaskRequest, TaskStartedEvent, ToolCompletedEvent, ToolStartedEvent };
