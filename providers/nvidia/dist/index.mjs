// src/index.ts
import { ProviderError } from "@comu/shared";
var NvidiaProvider = class {
  id = "nvidia-nemotron-3-ultra";
  name = "Nemotron 3 Ultra";
  apiKey;
  endpoint = "https://integrate.api.nvidia.com/v1/chat/completions";
  constructor(apiKey) {
    if (!apiKey) {
      throw new ProviderError("NVIDIA API Key is required");
    }
    this.apiKey = apiKey;
  }
  getCapabilities() {
    return {
      toolCalling: true,
      streaming: true,
      reasoning: false,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 128e3
    };
  }
  mapMessages(request) {
    const messages = [];
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
            tool_calls: msg.toolCalls.map((tc) => ({
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
  mapTools(tools) {
    if (!tools || tools.length === 0) return void 0;
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }));
  }
  async generate(request) {
    const messages = this.mapMessages(request);
    const tools = this.mapTools(request.tools);
    const body = {
      model: "nvidia/nemotron-4-340b-instruct",
      messages,
      temperature: request.temperature ?? 0.1,
      // Lower temperature for agentic tasks
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
        throw new ProviderError(`NVIDIA API Error: ${response.status} - ${errorText}`);
      }
      const data = await response.json();
      const message = data.choices[0].message;
      let toolCalls;
      if (message.tool_calls && message.tool_calls.length > 0) {
        toolCalls = message.tool_calls.map((tc) => {
          let parsedArgs = tc.function.arguments;
          if (typeof parsedArgs === "string") {
            try {
              parsedArgs = JSON.parse(parsedArgs);
            } catch {
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
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`Failed to call NVIDIA API: ${error.message}`);
    }
  }
};
export {
  NvidiaProvider
};
