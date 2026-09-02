// src/errors.ts
var BaseError = class extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
};
var ModelError = class extends BaseError {
};
var ProviderError = class extends BaseError {
};
var ToolError = class extends BaseError {
};
var PermissionError = class extends BaseError {
};
var WorkspaceError = class extends BaseError {
};
var ProtocolError = class extends BaseError {
};
var TimeoutError = class extends BaseError {
};
var TaskCancelledError = class extends BaseError {
};
export {
  BaseError,
  ModelError,
  PermissionError,
  ProtocolError,
  ProviderError,
  TaskCancelledError,
  TimeoutError,
  ToolError,
  WorkspaceError
};
