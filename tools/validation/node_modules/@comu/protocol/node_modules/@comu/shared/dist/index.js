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
  BaseError: () => BaseError,
  ModelError: () => ModelError,
  PermissionError: () => PermissionError,
  ProtocolError: () => ProtocolError,
  ProviderError: () => ProviderError,
  TaskCancelledError: () => TaskCancelledError,
  TimeoutError: () => TimeoutError,
  ToolError: () => ToolError,
  WorkspaceError: () => WorkspaceError
});
module.exports = __toCommonJS(index_exports);

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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BaseError,
  ModelError,
  PermissionError,
  ProtocolError,
  ProviderError,
  TaskCancelledError,
  TimeoutError,
  ToolError,
  WorkspaceError
});
