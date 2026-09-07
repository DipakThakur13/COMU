import { ProviderCapabilityProfile } from "./capabilities.js";

export class RequestSanitizer {
  /**
   * Sanitizes an outgoing model request payload against a target provider's capability profile.
   * Produces a clean payload without mutating the original input.
   */
  public static sanitize(
    payload: Record<string, any>,
    profile: ProviderCapabilityProfile
  ): Record<string, any> {
    const sanitized = { ...payload };

    // 1. Temperature
    if (!profile.supportsTemperature) {
      delete sanitized.temperature;
    }

    // 2. Top-P
    if (!profile.supportsTopP) {
      delete sanitized.top_p;
    }

    // 3. Top-K
    if (!profile.supportsTopK) {
      delete sanitized.top_k;
    }

    // 4. Stop sequences
    if (!profile.supportsStop) {
      delete sanitized.stop;
    }

    // 5. Logprobs
    if (!profile.supportsLogprobs) {
      delete sanitized.logprobs;
      delete sanitized.top_logprobs;
    }

    // 6. Penalties
    if (!profile.supportsPresencePenalty) {
      delete sanitized.presence_penalty;
    }
    if (!profile.supportsFrequencyPenalty) {
      delete sanitized.frequency_penalty;
    }

    // 7. Seed
    if (!profile.supportsSeed) {
      delete sanitized.seed;
    }

    // 8. Streaming
    if (!profile.supportsStreaming && sanitized.stream) {
      sanitized.stream = false;
    }

    // 9. Tool calling
    if (!profile.supportsToolCalling) {
      delete sanitized.tools;
      delete sanitized.tool_choice;
    }

    // 10. Max token bounding
    if (profile.maxOutputTokens && sanitized.max_tokens !== undefined) {
      if (typeof sanitized.max_tokens === "number" && sanitized.max_tokens > profile.maxOutputTokens) {
        sanitized.max_tokens = profile.maxOutputTokens;
      }
    }

    return sanitized;
  }
}
