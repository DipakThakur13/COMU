import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NvidiaProvider } from "@comu/provider-nvidia";
import { OllamaProvider } from "@comu/model-core";
import { ProviderManager } from "../src/providers/provider_manager.js";
import { SecretManager } from "../src/security/secrets.js";

/**
 * A provider's status is what its last probe found. A stored key is an input to that, never a status.
 *
 * The defect this guards: the NVIDIA card showed a green "Connected" badge, derived from a key being
 * present, directly above its own report that the connection had timed out.
 */

const store = new Map<string, string>();
SecretManager.initialize({
  secrets: {
    get: async (name: string) => store.get(name),
    store: async (name: string, value: string) => void store.set(name, value),
    delete: async (name: string) => void store.delete(name)
  }
} as any);

const nvidiaOf = async (manager: ProviderManager) =>
  (await manager.getProvidersState(true)).find(p => p.providerId === "nvidia")!;

describe("provider status is derived from the last probe", () => {
  beforeEach(() => {
    store.clear();
    vi.stubEnv("NVIDIA_API_KEY", "");
    // Nothing here may reach a network: the local daemon and the cloud endpoint are both stubbed.
    vi.spyOn(OllamaProvider, "probe").mockResolvedValue({ provider: "ollama", status: "CONNECTION_ERROR", message: "Ollama is not running." });
    vi.spyOn(OllamaProvider, "listModels").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reports no credential as not configured", async () => {
    const nvidia = await nvidiaOf(new ProviderManager());
    expect(nvidia.status).toBe("NOT_CONFIGURED");
    expect(nvidia.lastCheck).toBeUndefined();
  });

  it("reports a saved key that nothing has probed as unchecked, never connected", async () => {
    const manager = new ProviderManager();
    await manager.setProviderKey("nvidia", "nvapi-test");
    const nvidia = await nvidiaOf(manager);
    expect(nvidia.hasCredential).toBe(true);
    expect(nvidia.status).toBe("UNCHECKED");
  });

  it("reports a key whose probe timed out as timed out, with the reason and the time of the check", async () => {
    vi.spyOn(NvidiaProvider, "testConnection").mockResolvedValue({
      provider: "nvidia",
      status: "TIMEOUT",
      message: "Connection timed out after 15 seconds."
    });
    const manager = new ProviderManager();
    await manager.setProviderKey("nvidia", "nvapi-test");

    const result = await manager.testConnection("nvidia");
    const nvidia = await nvidiaOf(manager);

    expect(nvidia.status).toBe("TIMEOUT");
    expect(nvidia.lastCheck?.message).toBe("Connection timed out after 15 seconds.");
    expect(nvidia.lastCheck?.checkedAt).toBe(result.checkedAt);
    expect(Number.isNaN(Date.parse(result.checkedAt!))).toBe(false);
  });

  it("reports connected only after a probe succeeds", async () => {
    vi.spyOn(NvidiaProvider, "testConnection").mockResolvedValue({ provider: "nvidia", status: "CONNECTED", latencyMs: 900 });
    const manager = new ProviderManager();
    await manager.setProviderKey("nvidia", "nvapi-test");
    await manager.testConnection("nvidia");
    expect((await nvidiaOf(manager)).status).toBe("CONNECTED");
  });

  it("forgets the probe when the key changes, because it described the old key", async () => {
    vi.spyOn(NvidiaProvider, "testConnection").mockResolvedValue({ provider: "nvidia", status: "CONNECTED" });
    const manager = new ProviderManager();
    await manager.setProviderKey("nvidia", "nvapi-old");
    await manager.testConnection("nvidia");

    await manager.setProviderKey("nvidia", "nvapi-new");
    const nvidia = await nvidiaOf(manager);
    expect(nvidia.status).toBe("UNCHECKED");
    expect(nvidia.lastCheck).toBeUndefined();
  });

  it("keeps the probe when the same endpoint is saved again, and forgets it for a different one", async () => {
    vi.spyOn(NvidiaProvider, "testConnection").mockResolvedValue({ provider: "nvidia", status: "CONNECTED" });
    const manager = new ProviderManager();
    await manager.setProviderKey("nvidia", "nvapi-test");
    await manager.setProviderEndpoint("nvidia", NvidiaProvider.DEFAULT_ENDPOINT);
    await manager.testConnection("nvidia");

    await manager.setProviderEndpoint("nvidia", NvidiaProvider.DEFAULT_ENDPOINT);
    expect((await nvidiaOf(manager)).status).toBe("CONNECTED");

    await manager.setProviderEndpoint("nvidia", "https://example.invalid/v1/chat/completions");
    expect((await nvidiaOf(manager)).status).toBe("UNCHECKED");
  });

  it("does not claim a key works for a provider that has no connection test", async () => {
    const manager = new ProviderManager();
    await manager.setProviderKey("anthropic", "sk-ant-test");
    const result = await manager.testConnection("anthropic");
    expect(result.status).toBe("UNCHECKED");
    expect(result.message).toMatch(/has not been checked/);
    expect(result.checkedAt).toBeUndefined();
  });

  it("checks every NVIDIA catalogue model against the NVIDIA key, not only ids that contain 'nvidia'", async () => {
    // moonshotai/kimi-k3 used to fall to the generic branch and be looked up under its own id,
    // so a user with an NVIDIA key was told the model had no key.
    const manager = new ProviderManager();
    await manager.setProviderKey("nvidia", "nvapi-test");
    for (const id of ["moonshotai/kimi-k3", "poolside/laguna-xs-2.1", "nvidia/nemotron-3-ultra-550b-a55b"]) {
      const check = await manager.isProviderConfigured(id);
      expect(check).toMatchObject({ configured: true, providerId: "nvidia" });
    }
  });

  it("does not treat an empty model id as NVIDIA", async () => {
    const manager = new ProviderManager();
    await manager.setProviderKey("nvidia", "nvapi-test");
    expect((await manager.isProviderConfigured("")).providerId).not.toBe("nvidia");
  });

  it("stamps the local daemon's probe too, so its badge carries a time", async () => {
    const ollama = (await new ProviderManager().getProvidersState(true)).find(p => p.providerId === "ollama")!;
    expect(ollama.status).toBe("CONNECTION_ERROR");
    expect(ollama.lastCheck?.checkedAt).toBeDefined();
  });
});
