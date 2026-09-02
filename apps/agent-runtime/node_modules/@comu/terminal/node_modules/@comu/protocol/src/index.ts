export interface SelectionContext {
  filePath: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  text: string;
}

export interface TaskRequest {
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

export interface AgentEventBase {
  type: string;
  eventId: string;
  taskId: string;
  timestamp: string;
}

export interface TaskStartedEvent extends AgentEventBase {
  type: "task.started";
}

export interface AgentStatusEvent extends AgentEventBase {
  type: "agent.status";
  status: string;
}

export interface ToolStartedEvent extends AgentEventBase {
  type: "tool.started";
  tool: string;
}

export interface ToolCompletedEvent extends AgentEventBase {
  type: "tool.completed";
  tool: string;
  result?: any;
}

export interface ChangeCreatedEvent extends AgentEventBase {
  type: "change.created";
  path: string;
  operation: "CREATE" | "MODIFY";
}

export interface TaskCompletedEvent extends AgentEventBase {
  type: "task.completed";
}

export interface TaskFailedEvent extends AgentEventBase {
  type: "task.failed";
  error: string;
  payload?: {
    code: string;
    message: string;
  };
}

export interface TaskCancelledEvent extends AgentEventBase {
  type: "task.cancelled";
}

export interface AgentLimitReachedEvent extends AgentEventBase {
  type: "agent.limit_reached";
  limit: string;
}

export interface CommandStartedEvent extends AgentEventBase {
  type: "command.started";
  commandId: string;
}

export interface CommandCompletedEvent extends AgentEventBase {
  type: "command.completed";
  commandId: string;
}

export interface CommandFailedEvent extends AgentEventBase {
  type: "command.failed";
  commandId: string;
}

export interface CommandTimeoutEvent extends AgentEventBase {
  type: "command.timeout";
  commandId: string;
}

export interface CommandCancelledEvent extends AgentEventBase {
  type: "command.cancelled";
  commandId: string;
}

export type AgentEvent =
  | TaskStartedEvent
  | AgentStatusEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ChangeCreatedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskCancelledEvent
  | AgentLimitReachedEvent
  | CommandStartedEvent
  | CommandCompletedEvent
  | CommandFailedEvent
  | CommandTimeoutEvent
  | CommandCancelledEvent;

export interface AgentLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxExecutionTimeMs: number;
}
