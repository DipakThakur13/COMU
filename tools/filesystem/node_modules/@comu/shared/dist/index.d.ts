declare class BaseError extends Error {
    constructor(message: string);
}
declare class ModelError extends BaseError {
}
declare class ProviderError extends BaseError {
}
declare class ToolError extends BaseError {
}
declare class PermissionError extends BaseError {
}
declare class WorkspaceError extends BaseError {
}
declare class ProtocolError extends BaseError {
}
declare class TimeoutError extends BaseError {
}
declare class TaskCancelledError extends BaseError {
}

export { BaseError, ModelError, PermissionError, ProtocolError, ProviderError, TaskCancelledError, TimeoutError, ToolError, WorkspaceError };
