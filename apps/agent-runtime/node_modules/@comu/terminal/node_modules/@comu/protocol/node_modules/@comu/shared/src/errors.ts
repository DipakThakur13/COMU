export class BaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ModelError extends BaseError {}
export class ProviderError extends BaseError {}
export class ToolError extends BaseError {}
export class PermissionError extends BaseError {}
export class WorkspaceError extends BaseError {}
export class ProtocolError extends BaseError {}
export class TimeoutError extends BaseError {}
export class TaskCancelledError extends BaseError {}
