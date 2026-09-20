import { ProviderCapabilityProfile } from "../capabilities.js";

/**
 * Capability profile for a local Ollama daemon reached through its OpenAI-compatible
 * endpoint (`/v1/chat/completions`).
 *
 * Ollama does not require an API key. The Authorization header is omitted entirely.
 * Context and output limits are conservative defaults; the effective window depends on the
 * model that is loaded and on the daemon's `num_ctx` configuration.
 */
export const OLLAMA_CAPABILITY_PROFILE: ProviderCapabilityProfile = {
  id: "ollama",
  name: "Ollama",
  displayName: "Ollama (Local)",
  description: "Local on-device inference through Ollama's OpenAI-compatible API",
  supportsTemperature: true,
  supportsTopP: true,
  supportsTopK: false,
  supportsStop: true,
  supportsLogprobs: false,
  supportsPresencePenalty: true,
  supportsFrequencyPenalty: true,
  supportsSeed: true,
  supportsStreaming: true,
  supportsToolCalling: true,
  supportsReasoning: true,
  supportsVision: false,
  maxContextTokens: 8_192,
  maxOutputTokens: 4_096,
  // Local inference: no per-token cost.
  pricePerMillionTokens: { input: 0, output: 0 },
  requiresApiKey: false,
  defaultEndpoint: "http://127.0.0.1:11434/v1",
  allowedModels: []
};
