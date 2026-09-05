import { ModelProvider, ModelCapabilities, ModelRequest, ModelResponse, ToolCall, ModelMessage, ModelRequestContext, ModelContentPart } from "@comu/model-core";
import { ProviderTestResult } from "@comu/protocol";
import { 
  ProviderError,
  ProviderAuthenticationError,
  ProviderRateLimitError,
  ProviderInvalidRequestError,
  ProviderProtocolError,
  UnsupportedModelError
} from "@comu/shared";
import { NvidiaModelCatalog } from "./catalog.js";

export class NvidiaProvider implements ModelProvider {
  public id = "nvidia";
  public name = "NVIDIA";
  public providerId = "nvidia";
  public displayName = "NVIDIA";
  public selectedModel = "nvidia/nemotron-3.5-lightning-30b-a3b";

  public static readonly DEFAULT_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

  private apiKey: string;
  private endpoint: string;

  public static normalizeEndpoint(endpoint?: string): string {
    if (!endpoint || !endpoint.trim()) {
      return NvidiaProvider.DEFAULT_ENDPOINT;
    }
    let ep = endpoint.trim().replace(/\/+$/, "");

    if (ep.includes("integrate.api.nvidia.com")) {
      return "https://integrate.api.nvidia.com/v1/chat/completions";
    }
    if (ep.endsWith("/v1")) {
      return `${ep}/chat/completions`;
    }
    if (ep.endsWith("/v1/chat") || ep.endsWith("/v1/chat/c")) {
      return ep.replace(/\/v1\/chat(\/c.*)?$/, "/v1/chat/completions");
    }
    return ep;
  }

  constructor(apiKey?: string, endpoint?: string, modelId?: string) {
    const resolvedKey = apiKey || process.env.NVIDIA_API_KEY;
    if (!resolvedKey) {
      throw new ProviderError("NVIDIA API Key is required");
    }
    this.apiKey = resolvedKey;
    this.endpoint = NvidiaProvider.normalizeEndpoint(endpoint);
    if (modelId) {
      this.selectedModel = modelId;
    }
  }

  public static detectEnvironmentCredential(): boolean {
    return !!(process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim().length > 0);
  }

  public static async testConnection(
    apiKey: string,
    endpoint = NvidiaProvider.DEFAULT_ENDPOINT,
    timeoutMs = 15000,
    model?: string
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

    const activeModel = model || NvidiaModelCatalog.getDefault().id;

    const ping = async (modelToTest: string) => {
      const body = {
        model: modelToTest,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1
      };

      return await fetch(resolvedEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    };

    try {
      const response = await ping(activeModel);

      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        return {
          provider: "nvidia",
          status: "CONNECTED",
          model: activeModel,
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

      if (response.status === 404) {
        return {
          provider: "nvidia",
          status: "CONNECTION_ERROR",
          message: `NVIDIA API returned HTTP 404. Model ${activeModel} could not be accessed.`
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
          message: `Connection to NVIDIA API timed out after ${Math.round(timeoutMs / 1000)}s.`
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
    return NvidiaProvider.testConnection(this.apiKey, this.endpoint, undefined, this.selectedModel);
  }

  getCapabilities(): ModelCapabilities {
    try {
      return NvidiaModelCatalog.get(this.selectedModel).capabilities;
    } catch {
      return NvidiaModelCatalog.getDefault().capabilities;
    }
  }

  private mapMessages(request: ModelRequest, supportsMultimodal: boolean): any[] {
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
          if (Array.isArray(msg.content)) {
            if (supportsMultimodal) {
              const formattedContent = msg.content.map((part: ModelContentPart) => {
                if (part.type === "text") return { type: "text", text: part.text };
                if (part.type === "image_url") {
                  if (part.imageUrl.startsWith("file://") || !part.imageUrl.startsWith("https://") && !part.imageUrl.startsWith("data:")) {
                    throw new ProviderInvalidRequestError("Image URL must be HTTPS or data URI.");
                  }
                  return { type: "image_url", image_url: { url: part.imageUrl } };
                }
                return part;
              });
              messages.push({ role: msg.role, content: formattedContent });
            } else {
              const textContent = msg.content.filter(p => p.type === "text").map(p => (p as any).text).join("\n");
              messages.push({ role: msg.role, content: textContent });
            }
          } else {
            messages.push({ role: msg.role, content: msg.content });
          }
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

  async generate(request: ModelRequest, context?: ModelRequestContext): Promise<ModelResponse> {
    const modelId = request.model || this.selectedModel;
    let profile;
    try {
      profile = NvidiaModelCatalog.get(modelId);
    } catch (e: any) {
      throw new UnsupportedModelError(e.message);
    }

    const messages = this.mapMessages(request, profile.capabilities.multimodal ?? false);
    const tools = profile.capabilities.toolCalling ? this.mapTools(request.tools) : undefined;

    const stream = request.temperature !== undefined ? (request as any).stream : profile.defaults.stream;

    const body: any = {
      model: modelId,
      messages,
      temperature: request.temperature ?? profile.defaults.temperature,
      max_tokens: request.maxTokens ?? profile.defaults.maxTokens,
      stream: stream ?? false
    };

    if (profile.defaults.topP !== undefined) {
      body.top_p = profile.defaults.topP;
    }
    if (profile.defaults.seed !== undefined) {
      body.seed = profile.defaults.seed;
    }

    if (profile.modelSpecificOptions) {
      if (profile.modelSpecificOptions.chatTemplateKwargs) {
        body.chat_template_kwargs = profile.modelSpecificOptions.chatTemplateKwargs;
      }
      if (profile.modelSpecificOptions.reasoningBudget !== undefined) {
        body.reasoning_budget = profile.modelSpecificOptions.reasoningBudget;
      }
      if (profile.modelSpecificOptions.reasoningEffort !== undefined) {
        body.reasoning_effort = profile.modelSpecificOptions.reasoningEffort;
      }
    }

    if (tools) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    try {
      const fetchOptions: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      };

      if (context?.signal) {
        fetchOptions.signal = context.signal;
      }

      const response = await fetch(this.endpoint, fetchOptions);

      if (!response.ok) {
        const errorText = await response.text();
        const sanitizedText = errorText.slice(0, 100).replace(this.apiKey, "[REDACTED]");
        const message = `NVIDIA API Error: ${response.status} - ${sanitizedText}`;
        
        if (response.status === 401 || response.status === 403) {
          throw new ProviderAuthenticationError(message);
        } else if (response.status === 429) {
          throw new ProviderRateLimitError(message);
        } else if (response.status === 400 || response.status === 422) {
          throw new ProviderInvalidRequestError(message);
        } else {
          throw new ProviderError(message);
        }
      }

      if (body.stream && response.body) {
        return this.parseStream(response.body, context);
      } else {
        const data = (await response.json()) as any;
        if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
          throw new ProviderProtocolError("NVIDIA API returned malformed response payload.");
        }
        
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

        const extracted = NvidiaProvider.extractThinking(message.content || "", message.reasoning_content || message.reasoning);

        return {
          text: extracted.text,
          thinking: extracted.thinking,
          toolCalls,
          usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0
          }
        };
      }
    } catch (error: any) {
      if (error instanceof ProviderError) throw error;
      if (error.name === "AbortError" || context?.signal?.aborted) {
        throw new ProviderError("Request cancelled.");
      }
      throw new ProviderError(`Failed to call NVIDIA API: ${error.message}`);
    }
  }

  private async parseStream(body: ReadableStream<Uint8Array>, context?: ModelRequestContext): Promise<ModelResponse> {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullText = "";
    let fullReasoning = "";
    let toolCallsMap = new Map<number, any>();
    
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    let buffer = "";

    try {
      while (true) {
        if (context?.signal?.aborted) {
          throw new ProviderError("Request cancelled.");
        }
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim() === "" || !line.startsWith("data: ")) continue;
          const dataStr = line.replace(/^data: /, "").trim();
          if (dataStr === "[DONE]") continue;

          try {
            const data = JSON.parse(dataStr);
            if (data.usage) {
              promptTokens = data.usage.prompt_tokens ?? promptTokens;
              completionTokens = data.usage.completion_tokens ?? completionTokens;
              totalTokens = data.usage.total_tokens ?? totalTokens;
            }

            if (!data.choices || !data.choices[0] || !data.choices[0].delta) continue;
            
            const delta = data.choices[0].delta;
            if (delta.content) {
              fullText += delta.content;
            }
            if (delta.reasoning_content || delta.reasoning) {
              fullReasoning += (delta.reasoning_content || delta.reasoning);
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index;
                if (!toolCallsMap.has(index)) {
                  toolCallsMap.set(index, {
                    id: tc.id || `call_${index}`,
                    type: "function",
                    function: { name: tc.function?.name || "", arguments: tc.function?.arguments || "" }
                  });
                } else {
                  const existing = toolCallsMap.get(index);
                  if (tc.function?.arguments) {
                    existing.function.arguments += tc.function.arguments;
                  }
                }
              }
            }
          } catch (e) {
            // ignore JSON parse error for incomplete chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    let toolCalls: ToolCall[] | undefined;
    if (toolCallsMap.size > 0) {
      toolCalls = Array.from(toolCallsMap.values()).map(tc => {
        let parsedArgs = tc.function.arguments;
        try {
          if (typeof parsedArgs === "string" && parsedArgs.trim() !== "") {
            parsedArgs = JSON.parse(parsedArgs);
          }
        } catch {
          // ignore
        }
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: parsedArgs
        };
      });
    }

    const extracted = NvidiaProvider.extractThinking(fullText, fullReasoning);

    return {
      text: extracted.text,
      thinking: extracted.thinking,
      toolCalls,
      usage: { promptTokens, completionTokens, totalTokens }
    };
  }

  public static extractThinking(content: string, reasoningContent?: string): { text: string; thinking?: string } {
    let rawContent = content || "";
    let thinking: string | undefined = reasoningContent ? String(reasoningContent).trim() : undefined;

    const thinkTagRegex = /<(think|thought)>([\s\S]*?)<\/\1>/gi;
    const unclosedThinkRegex = /<(think|thought)>([\s\S]*)$/i;

    const extractedThoughts: string[] = [];
    let match;
    while ((match = thinkTagRegex.exec(rawContent)) !== null) {
      if (match[2] && match[2].trim()) {
        extractedThoughts.push(match[2].trim());
      }
    }

    let cleanedContent = rawContent.replace(thinkTagRegex, "").trim();
    const unclosedMatch = unclosedThinkRegex.exec(cleanedContent);
    if (unclosedMatch) {
      if (unclosedMatch[2] && unclosedMatch[2].trim()) {
        extractedThoughts.push(unclosedMatch[2].trim());
      }
      cleanedContent = cleanedContent.replace(unclosedThinkRegex, "").trim();
    }

    if (extractedThoughts.length > 0) {
      const joinedThoughts = extractedThoughts.join("\n\n");
      thinking = thinking ? `${thinking}\n\n${joinedThoughts}` : joinedThoughts;
    }

    return { text: cleanedContent, thinking };
  }
}
