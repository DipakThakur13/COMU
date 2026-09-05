import { ModelProfile } from "@comu/model-core";
import { UnsupportedModelError } from "@comu/shared";

export const NVIDIA_MODELS: ModelProfile[] = [
  {
    id: "deepseek-ai/deepseek-v4-pro-0813",
    providerId: "nvidia",
    name: "DeepSeek V4 Pro 0813",
    displayName: "DeepSeek V4 Pro 0813",
    capabilities: {
      toolCalling: true,
      streaming: false,
      reasoning: true,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 128000,
      chat: true,
      coding: true
    },
    performanceTier: "deep",
    defaults: {
      temperature: 1,
      topP: 0.95,
      maxTokens: 16384,
      seed: 42,
      stream: false
    },
    modelSpecificOptions: {
      chatTemplateKwargs: { thinking: false }
    }
  },
  {
    id: "nvidia/nemotron-3.5-lightning-30b-a3b",
    providerId: "nvidia",
    name: "Nemotron 3.5 Lightning 30B-A3B",
    displayName: "Nemotron 3.5 Lightning 30B-A3B",
    capabilities: {
      toolCalling: true,
      streaming: true,
      reasoning: true,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 128000,
      chat: true,
      coding: true
    },
    performanceTier: "fast",
    defaults: {
      temperature: 1,
      topP: 0.95,
      maxTokens: 16384,
      stream: true
    },
    modelSpecificOptions: {
      reasoningBudget: 16384,
      chatTemplateKwargs: { enable_thinking: true }
    }
  },
  {
    id: "moonshotai/kimi-k3",
    providerId: "nvidia",
    name: "Kimi K3",
    displayName: "Kimi K3",
    capabilities: {
      toolCalling: true,
      streaming: true,
      reasoning: true,
      vision: true,
      structuredOutput: true,
      maxContextTokens: 128000,
      chat: true,
      coding: true,
      multimodal: true
    },
    performanceTier: "deep",
    defaults: {
      temperature: 1,
      maxTokens: 16384,
      seed: 0,
      stream: true
    },
    modelSpecificOptions: {
      reasoningEffort: "max"
    }
  },
  {
    id: "deepseek-ai/deepseek-v4-flash-0731",
    providerId: "nvidia",
    name: "DeepSeek V4 Flash 0731",
    displayName: "DeepSeek V4 Flash 0731",
    capabilities: {
      toolCalling: true,
      streaming: false,
      reasoning: true,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 128000,
      chat: true,
      coding: true
    },
    performanceTier: "fast",
    defaults: {
      temperature: 1,
      topP: 0.95,
      maxTokens: 16384,
      stream: false
    },
    modelSpecificOptions: {
      chatTemplateKwargs: { thinking: true, reasoning_effort: "high" }
    }
  },
  {
    id: "poolside/laguna-xs-2.1",
    providerId: "nvidia",
    name: "Laguna XS 2.1",
    displayName: "Laguna XS 2.1",
    capabilities: {
      toolCalling: true,
      streaming: false,
      reasoning: true,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 32768,
      chat: true,
      coding: true
    },
    performanceTier: "balanced",
    defaults: {
      temperature: 1,
      topP: 0.95,
      maxTokens: 8192,
      stream: false
    }
  },
  {
    id: "meta/muse-glimmer-30b",
    providerId: "nvidia",
    name: "Muse Glimmer 30B",
    displayName: "Muse Glimmer 30B",
    capabilities: {
      toolCalling: false,
      streaming: false,
      reasoning: true,
      vision: true,
      structuredOutput: false,
      maxContextTokens: 128000,
      chat: true,
      coding: false,
      multimodal: true
    },
    performanceTier: "balanced",
    defaults: {
      temperature: 1,
      topP: 0.95,
      maxTokens: 8192,
      stream: false
    }
  },
  // Legacy models
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b",
    providerId: "nvidia",
    name: "Nemotron 3 Ultra",
    displayName: "Nemotron 3 Ultra",
    capabilities: {
      toolCalling: true,
      streaming: true,
      reasoning: true,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 128000,
      chat: true,
      coding: true
    },
    performanceTier: "deep",
    defaults: {
      temperature: 0.1,
      maxTokens: 1024,
      stream: true
    },
    modelSpecificOptions: {
      chatTemplateKwargs: { enable_thinking: true }
    }
  },
  {
    id: "nvidia/nemotron-4-340b-instruct",
    providerId: "nvidia",
    name: "Nemotron 4 340B Instruct",
    displayName: "Nemotron 4 340B Instruct",
    capabilities: {
      toolCalling: true,
      streaming: true,
      reasoning: true,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 128000,
      chat: true,
      coding: true
    },
    performanceTier: "balanced",
    defaults: {
      temperature: 0.1,
      maxTokens: 1024,
      stream: true
    },
    modelSpecificOptions: {
      chatTemplateKwargs: { enable_thinking: true }
    }
  }
];

export class NvidiaModelCatalog {
  private static models = new Map<string, ModelProfile>(
    NVIDIA_MODELS.map(m => [m.id, m])
  );

  public static get(modelId: string): ModelProfile {
    const profile = this.models.get(modelId);
    if (!profile) {
      throw new UnsupportedModelError(`Model ${modelId} is not supported by the NVIDIA provider.`);
    }
    return profile;
  }

  public static list(): ModelProfile[] {
    return Array.from(this.models.values());
  }

  public static has(modelId: string): boolean {
    return this.models.has(modelId);
  }

  public static getDefault(): ModelProfile {
    return this.get("nvidia/nemotron-3.5-lightning-30b-a3b");
  }
}
