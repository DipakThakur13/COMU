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
  NvidiaProvider: () => NvidiaProvider
});
module.exports = __toCommonJS(index_exports);
var import_shared = require("@comu/shared");
var NvidiaProvider = class {
  id = "nvidia-nemotron-3-ultra";
  name = "Nemotron 3 Ultra";
  apiKey;
  endpoint = "https://integrate.api.nvidia.com/v1/chat/completions";
  constructor(apiKey) {
    if (!apiKey) {
      throw new import_shared.ProviderError("NVIDIA API Key is required");
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
        throw new import_shared.ProviderError(`NVIDIA API Error: ${response.status} - ${errorText}`);
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
      if (error instanceof import_shared.ProviderError) throw error;
      throw new import_shared.ProviderError(`Failed to call NVIDIA API: ${error.message}`);
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  NvidiaProvider
});
