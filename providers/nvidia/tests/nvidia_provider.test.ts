import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NvidiaProvider } from "../src/index";

describe("NvidiaProvider BYOK & Connection Testing", () => {
  const originalEnv = process.env.NVIDIA_API_KEY;

  beforeEach(() => {
    delete process.env.NVIDIA_API_KEY;
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.NVIDIA_API_KEY = originalEnv;
    } else {
      delete process.env.NVIDIA_API_KEY;
    }
    vi.restoreAllMocks();
  });

  it("exposes canonical metadata properties", () => {
    const provider = new NvidiaProvider("test-key");
    expect(provider.providerId).toBe("nvidia");
    expect(provider.displayName).toBe("NVIDIA");
    expect(provider.selectedModel).toBe("Nemotron 3 Ultra");
  });

  it("detects environment credential correctly", () => {
    expect(NvidiaProvider.detectEnvironmentCredential()).toBe(false);

    process.env.NVIDIA_API_KEY = "nvapi-test-env-key";
    expect(NvidiaProvider.detectEnvironmentCredential()).toBe(true);

    process.env.NVIDIA_API_KEY = "   ";
    expect(NvidiaProvider.detectEnvironmentCredential()).toBe(false);
  });

  it("returns NOT_CONFIGURED when no API key is provided for testConnection", async () => {
    const res = await NvidiaProvider.testConnection("");
    expect(res.status).toBe("NOT_CONFIGURED");
    expect(res.provider).toBe("nvidia");
  });

  it("returns CONNECTED with latency when endpoint responds with 200 OK", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "pong" } }] })
    });
    vi.stubGlobal("fetch", fakeFetch);

    const res = await NvidiaProvider.testConnection("nvapi-valid-key", "https://api.test.com");
    expect(res.status).toBe("CONNECTED");
    expect(res.model).toBe("Nemotron 3 Ultra");
    expect(typeof res.latencyMs).toBe("number");
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fakeFetch).toHaveBeenCalledWith("https://api.test.com", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer nvapi-valid-key"
      })
    }));
  });

  it("returns INVALID_CREDENTIAL on 401 unauthorized and never leaks the key", async () => {
    const canaryKey = "nvapi-SECRET-CANARY-987654";
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized"
    });
    vi.stubGlobal("fetch", fakeFetch);

    const res = await NvidiaProvider.testConnection(canaryKey);
    expect(res.status).toBe("INVALID_CREDENTIAL");
    expect(res.message).toContain("rejected");

    // Security check: canary key must never appear in response JSON
    const resString = JSON.stringify(res);
    expect(resString).not.toContain(canaryKey);
  });

  it("handles network errors safely without credential leakage", async () => {
    const canaryKey = "nvapi-SECRET-CANARY-ERROR-123";
    const fakeFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fakeFetch);

    const res = await NvidiaProvider.testConnection(canaryKey);
    expect(res.status).toBe("CONNECTION_ERROR");

    // Security check
    expect(JSON.stringify(res)).not.toContain(canaryKey);
  });

  it("normalizes NVIDIA integrate endpoints to chat/completions", () => {
    expect(NvidiaProvider.normalizeEndpoint("https://integrate.api.nvidia.com")).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(NvidiaProvider.normalizeEndpoint("https://integrate.api.nvidia.com/v1")).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(NvidiaProvider.normalizeEndpoint("https://integrate.api.nvidia.com/v1/")).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(NvidiaProvider.normalizeEndpoint("https://integrate.api.nvidia.com/v1/chat/c")).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(NvidiaProvider.normalizeEndpoint("https://integrate.api.nvidia.com/v1/chat/completions")).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(NvidiaProvider.normalizeEndpoint("")).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
  });

  it("falls back to secondary model when primary model returns 404", async () => {
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found"
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "pong" } }] })
      });
    vi.stubGlobal("fetch", fakeFetch);

    const res = await NvidiaProvider.testConnection("nvapi-valid-key");
    expect(res.status).toBe("CONNECTED");
    expect(res.model).toBe("Nemotron 4 340B");
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("extracts inline <think> tags cleanly into thinking trace and sanitizes text", () => {
    const raw = "<think>Analyzing user request for C++ code...</think>Here is the C++ sample code:\n```cpp\n#include <iostream>\n```";
    const result = NvidiaProvider.extractThinking(raw);
    expect(result.thinking).toBe("Analyzing user request for C++ code...");
    expect(result.text).toBe("Here is the C++ sample code:\n```cpp\n#include <iostream>\n```");
  });

  it("extracts reasoning_content and combines with inline tags when present", () => {
    const raw = "<thought>Refining code snippet.</thought>Final output";
    const result = NvidiaProvider.extractThinking(raw, "Initial reasoning chain.");
    expect(result.thinking).toContain("Initial reasoning chain.");
    expect(result.thinking).toContain("Refining code snippet.");
    expect(result.text).toBe("Final output");
  });
});

