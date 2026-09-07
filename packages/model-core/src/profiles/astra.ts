import { ProviderCapabilityProfile } from "../capabilities.js";

/**
 * Capability profile for GPT-6 Astra on Experiential Labs.
 *
 * CRITICAL INVARIANT:
 * GPT-6 Astra strictly prohibits sampling parameters:
 * - temperature
 * - top_p
 * - top_k
 * - stop
 * - logprobs
 * - presence_penalty
 * - frequency_penalty
 * - seed
 *
 * Passing any of these will cause the Astra API to return a 400 Bad Request error.
 * All sampling controls must be filtered out dynamically by RequestSanitizer.
 */
export const ASTRA_CAPABILITY_PROFILE: ProviderCapabilityProfile = {
  id: "gpt-6-astra",
  name: "GPT-6 Astra",
  displayName: "GPT-6 Astra (Experiential Labs)",
  description: "Frontier reasoning and coding model with 1.05M token context window",
  supportsTemperature: false,
  supportsTopP: false,
  supportsTopK: false,
  supportsStop: false,
  supportsLogprobs: false,
  supportsPresencePenalty: false,
  supportsFrequencyPenalty: false,
  supportsSeed: false,
  supportsStreaming: true,
  supportsToolCalling: true,
  supportsReasoning: true,
  supportsVision: false,
  maxContextTokens: 1_050_000,
  maxOutputTokens: 128_000,
  defaultEndpoint: "https://api.experiential.com/v1",
  allowedModels: ["gpt-6-astra", "astra", "gpt-6-astra-pro"]
};
