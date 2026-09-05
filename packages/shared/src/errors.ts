export class BaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ModelError extends BaseError {}
export class ProviderError extends BaseError {}

// Batch 5 Canonical Provider Errors
export class ProviderConnectionError extends ProviderError {}
export class ProviderTimeoutError extends ProviderError {}
export class ProviderRateLimitError extends ProviderError {}
export class ProviderAuthenticationError extends ProviderError {}
export class ProviderAuthorizationError extends ProviderError {}
export class ProviderInvalidRequestError extends ProviderError {}
export class ProviderUnavailableError extends ProviderError {}
export class ProviderProtocolError extends ProviderError {}
export class ProviderCancelledError extends ProviderError {}
export class ProviderUnknownError extends ProviderError {}

export class ToolError extends BaseError {}
export class PermissionError extends BaseError {}
export class WorkspaceError extends BaseError {}
export class ProtocolError extends BaseError {}
export class TimeoutError extends BaseError {}
export class TaskCancelledError extends BaseError {}
