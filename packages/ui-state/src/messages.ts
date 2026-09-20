import { InteractionResponse, ProviderConfig, ProviderTestResult, TaskAutonomy, TaskMode, WorkspaceMemoryEntry } from "@comu/protocol";
import { SequencedEvent, SessionState } from "./types.js";

/**
 * The typed message protocol between the extension host and the webview.
 *
 * Single source of truth for both sides: the host imports these, and so does the webview, so a
 * change to a message shape is a compile error on whichever side has not caught up.
 */

export interface HostSnapshotMessage {
  type: "session_snapshot";
  /** Sequence of the last event folded into this snapshot. */
  seq: number;
  state: SessionState;
}

/** A contiguous batch of sequenced events. Batching never reorders or skips. */
export interface HostEventsMessage {
  type: "session_events";
  events: SequencedEvent[];
}

export interface HostProvidersMessage {
  type: "providers_update";
  providers: ProviderConfig[];
}

export interface HostProviderTestMessage {
  type: "provider_test_result";
  providerId: string;
  result: ProviderTestResult;
}

export interface HostSettingsMessage {
  type: "settings_update";
  defaultAutonomy: TaskAutonomy;
  defaultModelId?: string;
  /** True when the experimental React interface is the active one. */
  experimentalUi?: boolean;
}

export interface HostMemoryMessage {
  type: "memory_update";
  entries: WorkspaceMemoryEntry[];
}

export interface HostErrorMessage {
  type: "error";
  message: string;
  hint?: string;
}

export interface HostOpenSettingsMessage {
  type: "open_settings";
  targetProviderId?: string;
}

export type HostToWebviewMessage =
  | HostSnapshotMessage
  | HostEventsMessage
  | HostProvidersMessage
  | HostProviderTestMessage
  | HostSettingsMessage
  | HostMemoryMessage
  | HostErrorMessage
  | HostOpenSettingsMessage;

export interface WebviewReadyMessage {
  type: "webview_ready";
}

/** Sent when the replica detects a gap and can no longer be trusted. */
export interface WebviewResyncMessage {
  type: "request_snapshot";
  reason: "gap" | "initial" | "manual";
  lastSeq: number;
}

export interface WebviewSubmitMessage {
  type: "submit_prompt";
  prompt: string;
  modelId: string;
  mode: TaskMode;
  autonomy: TaskAutonomy;
}

export interface WebviewCancelMessage {
  type: "cancel_task";
}

export interface WebviewRespondInteractionMessage {
  type: "respond_interaction";
  taskId: string;
  interactionId: string;
  response: InteractionResponse;
}

export interface WebviewOpenFileMessage {
  type: "open_file";
  path: string;
  line?: number;
}

export interface WebviewRequestDiffMessage {
  type: "request_diff";
  path: string;
}

export interface WebviewSelectModelMessage {
  type: "select_model";
  modelId: string;
}

export interface WebviewSetAutonomyMessage {
  type: "set_autonomy";
  autonomy: TaskAutonomy;
}

export interface WebviewRequestProvidersMessage {
  type: "request_providers";
}

export interface WebviewTelemetryMessage {
  type: "telemetry_metric";
  name: string;
  value: number;
  details?: string;
}

export type WebviewToHostMessage =
  | WebviewReadyMessage
  | WebviewResyncMessage
  | WebviewSubmitMessage
  | WebviewCancelMessage
  | WebviewRespondInteractionMessage
  | WebviewOpenFileMessage
  | WebviewRequestDiffMessage
  | WebviewSelectModelMessage
  | WebviewSetAutonomyMessage
  | WebviewRequestProvidersMessage
  | WebviewTelemetryMessage;
