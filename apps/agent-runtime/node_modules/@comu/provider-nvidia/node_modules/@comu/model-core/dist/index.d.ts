interface ModelCapabilities {
    toolCalling: boolean;
    streaming: boolean;
    reasoning: boolean;
    vision: boolean;
    structuredOutput: boolean;
    maxContextTokens: number;
}
interface ToolCall {
    id: string;
    name: string;
    arguments: any;
}
interface ModelMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
}
interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: any;
}
interface ModelRequest {
    prompt: string;
    systemPrompt?: string;
    messages?: ModelMessage[];
    temperature?: number;
    maxTokens?: number;
    tools?: ToolDefinition[];
}
interface ModelResponse {
    text: string;
    toolCalls?: ToolCall[];
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}
interface ModelProvider {
    id: string;
    name: string;
    getCapabilities(): ModelCapabilities;
    generate(request: ModelRequest): Promise<ModelResponse>;
}
interface ModelProfile {
    id: string;
    providerId: string;
    name: string;
}
interface ModelRouter {
    selectModel(task: any, availableModels: ModelProfile[]): Promise<ModelProfile>;
}

export type { ModelCapabilities, ModelMessage, ModelProfile, ModelProvider, ModelRequest, ModelResponse, ModelRouter, ToolCall, ToolDefinition };
