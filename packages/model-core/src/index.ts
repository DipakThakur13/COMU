export interface ModelCapabilities {
  toolCalling: boolean;
  streaming: boolean;
  reasoning: boolean;
  vision: boolean;
  structuredOutput: boolean;
  maxContextTokens: number;
  chat?: boolean;
  coding?: boolean;
  multimodal?: boolean;
  longContext?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ModelContentPart[];
  toolCalls?: ToolCall[];
  toolCallId?: string; // For tool results
}

export type ModelContentPart = 
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: string };

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
}

export interface ModelRequest {
  prompt: string; // Legacy fallback or single-turn prompt
  systemPrompt?: string;
  messages?: ModelMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  model?: string;
}

export interface ModelResponse {
  text: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ModelRequestContext {
  requestId: string;
  taskId: string;
  runId: string;
  timeoutMs: number;
  signal: AbortSignal;
  attempt: number;
  maxAttempts: number;
  startedAt: number;
}

export interface ModelProvider {
  id: string;
  name: string;
  getCapabilities(): ModelCapabilities;
  generate(request: ModelRequest, context?: ModelRequestContext): Promise<ModelResponse>;
}

export interface ModelDefaults {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  seed?: number;
  stream?: boolean;
}

export interface ModelSpecificOptions {
  reasoningBudget?: number;
  reasoningEffort?: string;
  chatTemplateKwargs?: Record<string, unknown>;
}

export interface ModelProfile {
  id: string;
  providerId: string;
  name: string;
  displayName: string;
  description?: string;
  capabilities: ModelCapabilities;
  performanceTier: "fast" | "balanced" | "deep";
  defaults: ModelDefaults;
  modelSpecificOptions?: ModelSpecificOptions;
}

export interface ModelRouter {
  selectModel(task: any, availableModels: ModelProfile[]): Promise<ModelProfile>;
}

export * from "./manager.js";
