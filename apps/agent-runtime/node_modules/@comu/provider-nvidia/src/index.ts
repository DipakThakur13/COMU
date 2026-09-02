import { ModelProvider, ModelCapabilities, ModelRequest, ModelResponse, ToolCall, ModelMessage } from "@comu/model-core";
import { ProviderError } from "@comu/shared";

export class NvidiaProvider implements ModelProvider {
  id = "nvidia-nemotron-3-ultra";
  name = "Nemotron 3 Ultra";
  
  private apiKey: string;
  private endpoint = "https://integrate.api.nvidia.com/v1/chat/completions";

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new ProviderError("NVIDIA API Key is required");
    }
    this.apiKey = apiKey;
  }

  getCapabilities(): ModelCapabilities {
    return {
      toolCalling: true,
      streaming: true,
      reasoning: false,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 128000,
    };
  }

  private mapMessages(request: ModelRequest): any[] {
    const messages: any[] = [];
    
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }

    if (request.messages && request.messages.length > 0) {
      for (const msg of request.messages) {
        if (msg.role === "tool") {
          messages.push({
            role: "tool",
            content: msg.content,
            tool_call_id: msg.toolCallId
          });
        } else if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
          messages.push({
            role: "assistant",
            content: msg.content || null,
            tool_calls: msg.toolCalls.map(tc => ({
              id: tc.id,
              type: "function",
              function: {
                name: tc.name,
                arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments)
              }
            }))
          });
        } else {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    } else {
      messages.push({ role: "user", content: request.prompt });
    }

    return messages;
  }

  private mapTools(tools?: any[]): any[] | undefined {
    if (!tools || tools.length === 0) return undefined;
    return tools.map(tool => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }));
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const messages = this.mapMessages(request);
    const tools = this.mapTools(request.tools);

    const body: any = {
      model: "nvidia/nemotron-4-340b-instruct",
      messages,
      temperature: request.temperature ?? 0.1, // Lower temperature for agentic tasks
      max_tokens: request.maxTokens ?? 1024,
    };

    if (tools) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(`NVIDIA API Error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      const message = data.choices[0].message;

      let toolCalls: ToolCall[] | undefined;
      if (message.tool_calls && message.tool_calls.length > 0) {
        toolCalls = message.tool_calls.map((tc: any) => {
          let parsedArgs = tc.function.arguments;
          if (typeof parsedArgs === "string") {
            try {
              parsedArgs = JSON.parse(parsedArgs);
            } catch {
              // Leave as string if it fails
            }
          }
          return {
            id: tc.id,
            name: tc.function.name,
            arguments: parsedArgs
          };
        });
      }

      return {
        text: message.content || "",
        toolCalls,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        }
      };
    } catch (error: any) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`Failed to call NVIDIA API: ${error.message}`);
    }
  }
}
