import { AgentEvent, AgentLimits } from "@comu/protocol";

export type AgentState = 
  | "IDLE"
  | "STARTING"
  | "THINKING"
  | "TOOL_CALLING"
  | "OBSERVING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "LIMIT_REACHED";

export interface OrchestratorContext {
  taskId: string;
  workspaceRoot: string;
  systemPrompt: string;
  userPrompt: string;
  limits: AgentLimits;
  onEvent: (event: AgentEvent) => void;
  abortSignal?: AbortSignal;
}

export interface AgentResult {
  status: "completed" | "failed" | "cancelled" | "limit_reached";
  finalText?: string;
  error?: string;
  steps: number;
  changeSet?: any;
}
