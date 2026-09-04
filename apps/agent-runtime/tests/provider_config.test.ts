import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import app from "../src/server";
import { Server } from "http";

describe("Runtime BYOK Provider Configuration & Task-Start Guard", () => {
  let server: Server;
  let baseUrl: string;
  const originalEnv = process.env.NVIDIA_API_KEY;

  beforeAll(async () => {
    delete process.env.NVIDIA_API_KEY;
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (originalEnv) {
      process.env.NVIDIA_API_KEY = originalEnv;
    } else {
      delete process.env.NVIDIA_API_KEY;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /v1/config/providers returns sanitized list without API keys", async () => {
    const res = await fetch(`${baseUrl}/v1/config/providers`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(Array.isArray(data.providers)).toBe(true);

    const nvidia = data.providers.find((p: any) => p.providerId === "nvidia");
    expect(nvidia).toBeDefined();
    expect(nvidia.displayName).toBe("NVIDIA");
    expect(nvidia.isLocal).toBe(false);
    expect(nvidia.hasCredential).toBe(false);

    const ollama = data.providers.find((p: any) => p.providerId === "ollama");
    expect(ollama).toBeDefined();
    expect(ollama.isLocal).toBe(true);
    expect(ollama.hasCredential).toBe(true);

    // Verify zero API keys in response
    const jsonStr = JSON.stringify(data);
    expect(jsonStr).not.toContain("apiKey");
  });

  it("Task-Start Guard: rejects task launch when provider has no credentials", async () => {
    // Reset config to empty
    await fetch(`${baseUrl}/v1/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: {} })
    });

    const res = await fetch(`${baseUrl}/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "test-guard-task",
        prompt: "Refactor code",
        modelId: "nvidia-nemotron-3-ultra",
        workspace: { workspaceRoot: "/tmp" }
      })
    });

    expect(res.status).toBe(400);
    const errData = await res.json() as any;
    expect(errData.error).toBe("PROVIDER_NOT_CONFIGURED");
    expect(errData.providerId).toBe("nvidia");
    expect(errData.message).toContain("NVIDIA");
  });

  it("Task-Start Guard: permits task launch for local models (Ollama)", async () => {
    const res = await fetch(`${baseUrl}/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: `task-local-${Date.now()}`,
        prompt: "Run local analysis",
        modelId: "ollama-llama-3",
        workspace: { workspaceRoot: "/tmp" }
      })
    });

    // Should NOT be rejected with 400 PROVIDER_NOT_CONFIGURED
    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.taskId).toBeDefined();
  });

  it("POST /v1/config/providers/nvidia/test returns NOT_CONFIGURED when no key provided", async () => {
    const res = await fetch(`${baseUrl}/v1/config/providers/nvidia/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    expect(res.status).toBe(200);
    const result = await res.json() as any;
    expect(result.status).toBe("NOT_CONFIGURED");
  });

  it("Security Test: Pushed secrets are NEVER leaked in status, provider list, or errors", async () => {
    const canaryKey = "nvapi-SUPER-SENSITIVE-CANARY-TOKEN-998877";

    // Push config with canary key
    const pushRes = await fetch(`${baseUrl}/v1/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          nvidia: {
            apiKey: canaryKey,
            endpoint: "https://integrate.api.nvidia.com/v1"
          }
        }
      })
    });
    expect(pushRes.status).toBe(200);

    // 1. Check GET /v1/config/providers
    const provRes = await fetch(`${baseUrl}/v1/config/providers`);
    const provData = await provRes.json() as any;
    const nvidia = provData.providers.find((p: any) => p.providerId === "nvidia");
    expect(nvidia.hasCredential).toBe(true);
    expect(JSON.stringify(provData)).not.toContain(canaryKey);

    // 2. Check GET /v1/config/providers/nvidia/status
    const statusRes = await fetch(`${baseUrl}/v1/config/providers/nvidia/status`);
    const statusData = await statusRes.json() as any;
    expect(statusData.hasCredential).toBe(true);
    expect(JSON.stringify(statusData)).not.toContain(canaryKey);
  });
});
