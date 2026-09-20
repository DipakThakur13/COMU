export interface ProviderCapabilityProfile {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  supportsTemperature: boolean;
  supportsTopP: boolean;
  supportsTopK: boolean;
  supportsStop: boolean;
  supportsLogprobs: boolean;
  supportsPresencePenalty: boolean;
  supportsFrequencyPenalty: boolean;
  supportsSeed: boolean;
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
  supportsReasoning: boolean;
  supportsVision: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
  /** Defaults to true. Local providers such as Ollama set this to false and send no Authorization header. */
  requiresApiKey?: boolean;
  customHeaders?: Record<string, string>;
  defaultEndpoint?: string;
  allowedModels?: string[];
}

export const DEFAULT_OPENAI_CAPABILITY_PROFILE: ProviderCapabilityProfile = {
  id: "openai-standard",
  name: "OpenAI Compatible Standard",
  displayName: "OpenAI Compatible",
  description: "Standard OpenAI-compatible chat completions interface",
  supportsTemperature: true,
  supportsTopP: true,
  supportsTopK: false,
  supportsStop: true,
  supportsLogprobs: true,
  supportsPresencePenalty: true,
  supportsFrequencyPenalty: true,
  supportsSeed: true,
  supportsStreaming: true,
  supportsToolCalling: true,
  supportsReasoning: true,
  supportsVision: true,
  maxContextTokens: 128_000,
  maxOutputTokens: 16_384,
  defaultEndpoint: "https://api.openai.com/v1"
};
