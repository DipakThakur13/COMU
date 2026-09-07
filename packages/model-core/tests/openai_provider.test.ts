import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
  OpenAICompatibleProvider, 
  RequestSanitizer, 
  ASTRA_CAPABILITY_PROFILE, 
  DEFAULT_OPENAI_CAPABILITY_PROFILE,
  ProviderCapabilityProfile
} from "../src/index.js";

describe("OpenAICompatibleProvider & RequestSanitizer (Provider-Neutral Gateway & Astra)", () => {
  describe("RequestSanitizer", () => {
    it("strips sampling parameters for Astra capability profile", () => {
      const originalPayload = {
        model: "gpt-6-astra",
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        stop: ["\n"],
        logprobs: true,
        presence_penalty: 0.5,
        frequency_penalty: 0.5,
        seed: 42,
        max_tokens: 4096
      };

      const sanitized = RequestSanitizer.sanitize(originalPayload, ASTRA_CAPABILITY_PROFILE);

      // Astra invariants
      expect(sanitized.temperature).toBeUndefined();
      expect(sanitized.top_p).toBeUndefined();
      expect(sanitized.top_k).toBeUndefined();
      expect(sanitized.stop).toBeUndefined();
      expect(sanitized.logprobs).toBeUndefined();
      expect(sanitized.presence_penalty).toBeUndefined();
      expect(sanitized.frequency_penalty).toBeUndefined();
      expect(sanitized.seed).toBeUndefined();

      // Allowed fields preserved
      expect(sanitized.model).toBe("gpt-6-astra");
      expect(sanitized.messages).toEqual(originalPayload.messages);
      expect(sanitized.max_tokens).toBe(4096);

      // Immutability check: original payload was not mutated
      expect(originalPayload.temperature).toBe(0.7);
      expect(originalPayload.top_p).toBe(0.9);
    });

    it("preserves sampling parameters for standard OpenAI profile", () => {
      const payload = {
        model: "gpt-4o",
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.7,
        top_p: 0.9,
        stop: ["END"],
        seed: 1234,
        max_tokens: 2048
      };

      const sanitized = RequestSanitizer.sanitize(payload, DEFAULT_OPENAI_CAPABILITY_PROFILE);

      expect(sanitized.temperature).toBe(0.7);
      expect(sanitized.top_p).toBe(0.9);
      expect(sanitized.stop).toEqual(["END"]);
      expect(sanitized.seed).toBe(1234);
    });

    it("bounds max_tokens to maxOutputTokens", () => {
      const customProfile: ProviderCapabilityProfile = {
        ...DEFAULT_OPENAI_CAPABILITY_PROFILE,
        maxOutputTokens: 2000
      };

      const payload = {
        model: "test-model",
        max_tokens: 5000
      };

      const sanitized = RequestSanitizer.sanitize(payload, customProfile);
      expect(sanitized.max_tokens).toBe(2000);
    });
  });

  describe("ASTRA_CAPABILITY_PROFILE", () => {
    it("has 1.05M context window and strictly prohibits sampling", () => {
      expect(ASTRA_CAPABILITY_PROFILE.maxContextTokens).toBe(1_050_000);
      expect(ASTRA_CAPABILITY_PROFILE.maxOutputTokens).toBe(128_000);
      expect(ASTRA_CAPABILITY_PROFILE.supportsTemperature).toBe(false);
      expect(ASTRA_CAPABILITY_PROFILE.supportsTopP).toBe(false);
      expect(ASTRA_CAPABILITY_PROFILE.supportsTopK).toBe(false);
      expect(ASTRA_CAPABILITY_PROFILE.supportsStop).toBe(false);
      expect(ASTRA_CAPABILITY_PROFILE.supportsLogprobs).toBe(false);
      expect(ASTRA_CAPABILITY_PROFILE.supportsStreaming).toBe(true);
      expect(ASTRA_CAPABILITY_PROFILE.supportsToolCalling).toBe(true);
    });
  });

  describe("OpenAICompatibleProvider Initialization & Normalization", () => {
    it("auto-detects Astra profile when model is gpt-6-astra", () => {
      const provider = new OpenAICompatibleProvider("test-key", "https://api.experiential.com/v1", "gpt-6-astra");
      expect(provider.profile.id).toBe("gpt-6-astra");
      expect(provider.id).toBe("experiential");
      expect(provider.displayName).toContain("Astra");
    });

    it("normalizes endpoint URLs correctly", () => {
      expect(OpenAICompatibleProvider.normalizeEndpoint("https://api.openai.com/v1")).toBe(
        "https://api.openai.com/v1/chat/completions"
      );
      expect(OpenAICompatibleProvider.normalizeEndpoint("https://api.experiential.com/v1/chat/completions")).toBe(
        "https://api.experiential.com/v1/chat/completions"
      );
      expect(OpenAICompatibleProvider.normalizeEndpoint("https://custom.gateway.ai")).toBe(
        "https://custom.gateway.ai/chat/completions"
      );
    });

    it("reports longContext capability for 1.05M Astra context", () => {
      const provider = new OpenAICompatibleProvider("test-key", undefined, "gpt-6-astra");
      const caps = provider.getCapabilities();
      expect(caps.maxContextTokens).toBe(1_050_000);
      expect(caps.longContext).toBe(true);
      expect(caps.toolCalling).toBe(true);
      expect(caps.streaming).toBe(true);
    });
  });

  describe("OpenAICompatibleProvider Request Execution", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("sanitizes outgoing payload and parses non-streaming completion", async () => {
      let interceptedBody: any = null;

      globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
        interceptedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Here is your code.",
                  tool_calls: [
                    {
                      id: "call_123",
                      function: {
                        name: "read_file",
                        arguments: JSON.stringify({ path: "auth.ts" })
                      }
                    }
                  ]
                }
              }
            ],
            usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 }
          })
        };
      });

      const provider = new OpenAICompatibleProvider("mock-key", "https://api.experiential.com/v1", "gpt-6-astra");

      const response = await provider.generate({
        prompt: "Write a function",
        temperature: 0.8, // should be stripped for Astra
        maxTokens: 500,
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            inputSchema: { type: "object", properties: { path: { type: "string" } } }
          }
        ]
      });

      // Assert outgoing body had temperature stripped
      expect(interceptedBody.temperature).toBeUndefined();
      expect(interceptedBody.tools).toBeDefined();
      expect(interceptedBody.tools[0].function.name).toBe("read_file");

      // Assert response parsed properly
      expect(response.text).toBe("Here is your code.");
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls?.[0].name).toBe("read_file");
      expect(response.toolCalls?.[0].arguments).toEqual({ path: "auth.ts" });
      expect(response.usage?.totalTokens).toBe(40);
    });

    it("extracts thinking from <think> tags and reasoning fields", () => {
      const raw = "<think>Let me evaluate this logic</think>Here is the final answer.";
      const extracted = OpenAICompatibleProvider.extractThinking(raw);

      expect(extracted.text).toBe("Here is the final answer.");
      expect(extracted.thinking).toBe("Let me evaluate this logic");
    });

    it("redacts credentials from error messages", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 401,
          text: async () => "Unauthorized: secret-api-key-xyz is invalid"
        };
      });

      const provider = new OpenAICompatibleProvider("secret-api-key-xyz", "https://api.openai.com/v1", "gpt-4o");

      await expect(provider.generate({ prompt: "ping" })).rejects.toThrow();
      try {
        await provider.generate({ prompt: "ping" });
      } catch (err: any) {
        expect(err.message).not.toContain("secret-api-key-xyz");
        expect(err.message).toContain("[REDACTED]");
      }
    });

    it("testConnection returns CONNECTED on valid response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200
      });

      const res = await OpenAICompatibleProvider.testConnection(
        "test-key",
        "https://api.experiential.com/v1",
        5000,
        "gpt-6-astra"
      );

      expect(res.status).toBe("CONNECTED");
      expect(res.provider).toBe("experiential");
      expect(res.model).toBe("gpt-6-astra");
    });
  });
});
