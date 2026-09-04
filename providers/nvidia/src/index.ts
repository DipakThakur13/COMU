import { ModelProvider, ModelCapabilities, ModelRequest, ModelResponse, ToolCall, ModelMessage } from "@comu/model-core";
import { ProviderTestResult, ProviderStatus } from "@comu/protocol";
import { ProviderError } from "@comu/shared";

export class NvidiaProvider implements ModelProvider {
  public id = "nvidia";
  public name = "NVIDIA";
  public providerId = "nvidia";
  public displayName = "NVIDIA";
  public selectedModel = "Nemotron 3 Ultra";

  public static readonly DEFAULT_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
  public static readonly DEFAULT_MODEL = "nvidia/nemotron-4-340b-instruct";

  private apiKey: string;
  private endpoint: string;

  public static normalizeEndpoint(endpoint?: string): string {
    if (!endpoint || !endpoint.trim()) {
      return NvidiaProvider.DEFAULT_ENDPOINT;
    }
    let ep = endpoint.trim().replace(/\/+$/, "");
    if (ep.endsWith("/v1")) {
      return `${ep}/chat/completions`;
    }
    if (ep === "https://integrate.api.nvidia.com") {
      return "https://integrate.api.nvidia.com/v1/chat/completions";
    }
    if (ep.endsWith("/v1/chat") || ep.endsWith("/v1/chat/c")) {
      return ep.replace(/\/v1\/chat(\/c)?$/, "/v1/chat/completions");
    }
    return ep;
  }

  constructor(apiKey?: string, endpoint?: string) {
    const resolvedKey = apiKey || process.env.NVIDIA_API_KEY;
    if (!resolvedKey) {
      throw new ProviderError("NVIDIA API Key is required");
    }
    this.apiKey = resolvedKey;
    this.endpoint = NvidiaProvider.normalizeEndpoint(endpoint);
  }

  public static detectEnvironmentCredential(): boolean {
    return !!(process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim().length > 0);
  }

  public static async testConnection(
    apiKey: string,
    endpoint = NvidiaProvider.DEFAULT_ENDPOINT,
    timeoutMs = 6000
  ): Promise<ProviderTestResult> {
    const resolvedEndpoint = NvidiaProvider.normalizeEndpoint(endpoint);
    if (!apiKey || !apiKey.trim()) {
      return {
        provider: "nvidia",
        status: "NOT_CONFIGURED",
        message: "No NVIDIA API key provided."
      };
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const body = {
      model: NvidiaProvider.DEFAULT_MODEL,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1
    };

    try {
      const response = await fetch(resolvedEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        return {
          provider: "nvidia",
          status: "CONNECTED",
          model: "Nemotron 3 Ultra",
          latencyMs
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          provider: "nvidia",
          status: "INVALID_CREDENTIAL",
          message: "The NVIDIA API key was rejected."
        };
      }

      return {
        provider: "nvidia",
        status: "CONNECTION_ERROR",
        message: `NVIDIA API returned HTTP ${response.status}.`
      };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === "AbortError" || controller.signal.aborted) {
        return {
          provider: "nvidia",
          status: "TIMEOUT",
          message: "Connection to NVIDIA API timed out."
        };
      }

      return {
        provider: "nvidia",
        status: "CONNECTION_ERROR",
        message: "COMU could not reach the NVIDIA API."
      };
    }
  }

  public async testConnection(): Promise<ProviderTestResult> {
    return NvidiaProvider.testConnection(this.apiKey, this.endpoint);
  }

  getCapabilities(): ModelCapabilities {
    return {
      toolCalling: true,
      streaming: true,
      reasoning: false,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 128000
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
      model: NvidiaProvider.DEFAULT_MODEL,
      messages,
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 1024
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
        throw new ProviderError(`NVIDIA API Error: ${response.status} - ${errorText.slice(0, 100)}`);
      }

      const data = (await response.json()) as any;
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
          totalTokens: data.usage?.total_tokens ?? 0
        }
      };
    } catch (error: any) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`Failed to call NVIDIA API: ${error.message}`);
    }
  }
}
