import { 
  ModelProvider, 
  ModelCapabilities, 
  ModelRequest, 
  ModelResponse, 
  ToolCall, 
  ModelRequestContext, 
  ModelContentPart,
  ToolDefinition
} from "./index.js";
import { ProviderTestResult } from "@comu/protocol";
import { 
  ProviderError,
  ProviderAuthenticationError,
  ProviderRateLimitError,
  ProviderInvalidRequestError,
  ProviderProtocolError
} from "@comu/shared";
import { ProviderCapabilityProfile, DEFAULT_OPENAI_CAPABILITY_PROFILE } from "./capabilities.js";
import { ASTRA_CAPABILITY_PROFILE } from "./profiles/astra.js";
import { RequestSanitizer } from "./sanitizer.js";

export class OpenAICompatibleProvider implements ModelProvider {
  public id: string = "openai";
  public name: string = "OpenAI-Compatible";
  public providerId: string = "openai";
  public displayName: string = "OpenAI-Compatible";
  public selectedModel: string;
  public profile: ProviderCapabilityProfile;

  private apiKey: string;
  private endpoint: string;

  public static normalizeEndpoint(endpoint?: string, defaultEndpoint = "https://api.openai.com/v1"): string {
    if (!endpoint || !endpoint.trim()) {
      return defaultEndpoint.endsWith("/chat/completions") ? defaultEndpoint : `${defaultEndpoint.replace(/\/+$/, "")}/chat/completions`;
    }
    let ep = endpoint.trim().replace(/\/+$/, "");

    if (ep.endsWith("/chat/completions")) {
      return ep;
    }
    if (ep.endsWith("/v1")) {
      return `${ep}/chat/completions`;
    }
    if (ep.endsWith("/chat") || ep.endsWith("/chat/c")) {
      return ep.replace(/\/chat(\/c.*)?$/, "/chat/completions");
    }
    return `${ep}/chat/completions`;
  }

  constructor(apiKey?: string, endpoint?: string, modelId?: string, profile?: ProviderCapabilityProfile) {
    // Resolve profile
    if (profile) {
      this.profile = profile;
    } else if (
      modelId?.toLowerCase().includes("astra") ||
      endpoint?.toLowerCase().includes("experiential")
    ) {
      this.profile = ASTRA_CAPABILITY_PROFILE;
    } else {
      this.profile = DEFAULT_OPENAI_CAPABILITY_PROFILE;
    }

    if (this.profile.id === "gpt-6-astra") {
      this.id = "experiential";
      this.providerId = "experiential";
      this.name = "Experiential Labs";
      this.displayName = "GPT-6 Astra (Experiential Labs)";
    }

    const resolvedKey = apiKey || process.env.OPENAI_API_KEY || (this.profile.id === "gpt-6-astra" ? process.env.EXPERIENTIAL_API_KEY : undefined);
    if (!resolvedKey) {
      throw new ProviderError(`${this.displayName} API Key is required`);
    }
    this.apiKey = resolvedKey;

    const baseEndpoint = endpoint || this.profile.defaultEndpoint || "https://api.openai.com/v1";
    this.endpoint = OpenAICompatibleProvider.normalizeEndpoint(baseEndpoint, this.profile.defaultEndpoint);

    this.selectedModel = modelId || (this.profile.allowedModels?.[0] ?? "gpt-4o");
  }

  public static detectEnvironmentCredential(providerId = "openai"): boolean {
    if (providerId === "experiential" || providerId === "gpt-6-astra") {
      return !!(process.env.EXPERIENTIAL_API_KEY && process.env.EXPERIENTIAL_API_KEY.trim().length > 0);
    }
    return !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0);
  }

  public static async testConnection(
    apiKey: string,
    endpoint?: string,
    timeoutMs = 15000,
    model?: string,
    profile?: ProviderCapabilityProfile
  ): Promise<ProviderTestResult> {
    const activeProfile = profile || (
      model?.toLowerCase().includes("astra") || endpoint?.toLowerCase().includes("experiential")
        ? ASTRA_CAPABILITY_PROFILE
        : DEFAULT_OPENAI_CAPABILITY_PROFILE
    );

    const providerName = activeProfile.id === "gpt-6-astra" ? "experiential" : "openai";
    const resolvedEndpoint = OpenAICompatibleProvider.normalizeEndpoint(
      endpoint || activeProfile.defaultEndpoint,
      activeProfile.defaultEndpoint
    );

    if (!apiKey || !apiKey.trim()) {
      return {
        provider: providerName,
        status: "NOT_CONFIGURED",
        message: `No API key provided for ${activeProfile.displayName}.`
      };
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const activeModel = model || activeProfile.allowedModels?.[0] || "gpt-4o";

    const rawPayload: Record<string, any> = {
      model: activeModel,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1
    };

    // Sanitize test request per capability profile (e.g. ensure no temperature/top_p for Astra)
    const sanitizedPayload = RequestSanitizer.sanitize(rawPayload, activeProfile);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey.trim()}`,
        ...(activeProfile.customHeaders || {})
      };

      const response = await fetch(resolvedEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(sanitizedPayload),
        signal: controller.signal
      });

      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        return {
          provider: providerName,
          status: "CONNECTED",
          model: activeModel,
          latencyMs
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          provider: providerName,
          status: "INVALID_CREDENTIAL",
          message: `The ${activeProfile.displayName} API key was rejected.`
        };
      }

      if (response.status === 404) {
        return {
          provider: providerName,
          status: "CONNECTION_ERROR",
          message: `Endpoint returned HTTP 404. Model '${activeModel}' could not be accessed.`
        };
      }

      return {
        provider: providerName,
        status: "CONNECTION_ERROR",
        message: `API returned HTTP ${response.status}.`
      };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === "AbortError" || controller.signal.aborted) {
        return {
          provider: providerName,
          status: "TIMEOUT",
          message: `Connection to ${activeProfile.displayName} timed out after ${Math.round(timeoutMs / 1000)}s.`
        };
      }

      return {
        provider: providerName,
        status: "CONNECTION_ERROR",
        message: `Could not reach ${activeProfile.displayName} endpoint.`
      };
    }
  }

  public async testConnection(): Promise<ProviderTestResult> {
    return OpenAICompatibleProvider.testConnection(
      this.apiKey,
      this.endpoint,
      undefined,
      this.selectedModel,
      this.profile
    );
  }

  getCapabilities(): ModelCapabilities {
    return {
      toolCalling: this.profile.supportsToolCalling,
      streaming: this.profile.supportsStreaming,
      reasoning: this.profile.supportsReasoning,
      vision: this.profile.supportsVision,
      structuredOutput: true,
      maxContextTokens: this.profile.maxContextTokens,
      chat: true,
      coding: true,
      longContext: this.profile.maxContextTokens > 100_000
    };
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
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
            tool_call_id: msg.toolCallId
          });
        } else if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
          messages.push({
            role: "assistant",
            content: typeof msg.content === "string" ? msg.content : null,
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
                  if (part.imageUrl.startsWith("file://") || (!part.imageUrl.startsWith("https://") && !part.imageUrl.startsWith("data:"))) {
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

  private mapTools(tools?: ToolDefinition[]): any[] | undefined {
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
    const messages = this.mapMessages(request, this.profile.supportsVision);
    const tools = this.profile.supportsToolCalling ? this.mapTools(request.tools) : undefined;
    const stream = (request as any).stream ?? this.profile.supportsStreaming;

    const rawPayload: Record<string, any> = {
      model: modelId,
      messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream
    };

    if (tools) {
      rawPayload.tools = tools;
      rawPayload.tool_choice = "auto";
    }

    // Strictly sanitize payload according to capability profile
    const sanitizedBody = RequestSanitizer.sanitize(rawPayload, this.profile);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
        ...(this.profile.customHeaders || {})
      };

      const fetchOptions: RequestInit = {
        method: "POST",
        headers,
        body: JSON.stringify(sanitizedBody)
      };

      if (context?.signal) {
        fetchOptions.signal = context.signal;
      }

      const response = await fetch(this.endpoint, fetchOptions);

      if (!response.ok) {
        const errorText = await response.text();
        const sanitizedText = errorText.slice(0, 200).replace(this.apiKey, "[REDACTED]");
        const message = `${this.displayName} API Error: ${response.status} - ${sanitizedText}`;

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

      if (sanitizedBody.stream && response.body) {
        return this.parseStream(response.body, context);
      } else {
        const data = (await response.json()) as any;
        if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
          throw new ProviderProtocolError(`${this.displayName} API returned malformed response payload.`);
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
                // Keep as string if parsing fails
              }
            }
            return {
              id: tc.id,
              name: tc.function.name,
              arguments: parsedArgs
            };
          });
        }

        const extracted = OpenAICompatibleProvider.extractThinking(
          message.content || "", 
          message.reasoning_content || message.reasoning
        );

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
    } catch (err: any) {
      if (err instanceof ProviderError) throw err;
      if (err.name === "AbortError" || context?.signal?.aborted) {
        throw err;
      }
      const safeMessage = (err.message || String(err)).replace(this.apiKey, "[REDACTED]");
      throw new ProviderError(`${this.displayName} request failed: ${safeMessage}`);
    }
  }

  private async parseStream(streamBody: any, context?: ModelRequestContext): Promise<ModelResponse> {
    const reader = streamBody.getReader();
    const decoder = new TextDecoder("utf-8");

    let fullText = "";
    let fullReasoning = "";
    const toolCallsMap = new Map<number, any>();
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    let buffer = "";

    try {
      while (true) {
        if (context?.signal?.aborted) {
          throw new Error("Stream aborted by context signal");
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === "[DONE]") continue;

          try {
            const data = JSON.parse(jsonStr);

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
                const index = tc.index ?? 0;
                if (!toolCallsMap.has(index)) {
                  toolCallsMap.set(index, {
                    id: tc.id || `call_${index}`,
                    type: "function",
                    function: { name: tc.function?.name || "", arguments: tc.function?.arguments || "" }
                  });
                } else {
                  const existing = toolCallsMap.get(index);
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.function.name = tc.function.name;
                  if (tc.function?.arguments) {
                    existing.function.arguments += tc.function.arguments;
                  }
                }
              }
            }
          } catch {
            // Ignore incomplete chunks in SSE
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
          // Keep raw string if JSON parsing fails
        }
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: parsedArgs
        };
      });
    }

    const extracted = OpenAICompatibleProvider.extractThinking(fullText, fullReasoning);

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
