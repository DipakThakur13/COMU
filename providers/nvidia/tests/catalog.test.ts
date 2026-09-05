import { describe, it, expect } from "vitest";
import { NvidiaModelCatalog } from "../src/catalog";
import { UnsupportedModelError } from "@comu/shared";

describe("NvidiaModelCatalog (M01-M14)", () => {
  it("M01: All six new model IDs resolve", () => {
    expect(NvidiaModelCatalog.has("deepseek-ai/deepseek-v4-pro-0813")).toBe(true);
    expect(NvidiaModelCatalog.has("nvidia/nemotron-3.5-lightning-30b-a3b")).toBe(true);
    expect(NvidiaModelCatalog.has("moonshotai/kimi-k3")).toBe(true);
    expect(NvidiaModelCatalog.has("deepseek-ai/deepseek-v4-flash-0731")).toBe(true);
    expect(NvidiaModelCatalog.has("poolside/laguna-xs-2.1")).toBe(true);
    expect(NvidiaModelCatalog.has("meta/muse-glimmer-30b")).toBe(true);
  });

  it("M02: Unknown model throws UnsupportedModelError", () => {
    expect(() => NvidiaModelCatalog.get("unknown/model")).toThrowError(UnsupportedModelError);
  });

  it("M09: DeepSeek V4 Pro defaults are correct", () => {
    const profile = NvidiaModelCatalog.get("deepseek-ai/deepseek-v4-pro-0813");
    expect(profile.defaults.temperature).toBe(1);
    expect(profile.defaults.topP).toBe(0.95);
    expect(profile.defaults.maxTokens).toBe(16384);
    expect(profile.defaults.seed).toBe(42);
    expect(profile.defaults.stream).toBe(false);
    expect(profile.modelSpecificOptions?.chatTemplateKwargs).toEqual({ thinking: false });
  });

  it("M10: Nemotron Lightning defaults are correct", () => {
    const profile = NvidiaModelCatalog.get("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(profile.defaults.temperature).toBe(1);
    expect(profile.defaults.topP).toBe(0.95);
    expect(profile.defaults.maxTokens).toBe(16384);
    expect(profile.defaults.stream).toBe(true);
    expect(profile.modelSpecificOptions?.reasoningBudget).toBe(16384);
    expect(profile.modelSpecificOptions?.chatTemplateKwargs).toEqual({ enable_thinking: true });
  });

  it("M11: Kimi K3 defaults are correct", () => {
    const profile = NvidiaModelCatalog.get("moonshotai/kimi-k3");
    expect(profile.defaults.temperature).toBe(1);
    expect(profile.defaults.maxTokens).toBe(16384);
    expect(profile.defaults.seed).toBe(0);
    expect(profile.defaults.stream).toBe(true);
    expect(profile.modelSpecificOptions?.reasoningEffort).toBe("max");
  });

  it("M12: DeepSeek V4 Flash defaults are correct", () => {
    const profile = NvidiaModelCatalog.get("deepseek-ai/deepseek-v4-flash-0731");
    expect(profile.defaults.temperature).toBe(1);
    expect(profile.defaults.topP).toBe(0.95);
    expect(profile.defaults.maxTokens).toBe(16384);
    expect(profile.defaults.stream).toBe(false);
    expect(profile.modelSpecificOptions?.chatTemplateKwargs).toEqual({ thinking: true, reasoning_effort: "high" });
  });

  it("M13: Laguna XS 2.1 defaults are correct", () => {
    const profile = NvidiaModelCatalog.get("poolside/laguna-xs-2.1");
    expect(profile.defaults.temperature).toBe(1);
    expect(profile.defaults.topP).toBe(0.95);
    expect(profile.defaults.maxTokens).toBe(8192);
    expect(profile.defaults.stream).toBe(false);
  });

  it("M14: Muse Glimmer 30B defaults are correct", () => {
    const profile = NvidiaModelCatalog.get("meta/muse-glimmer-30b");
    expect(profile.defaults.temperature).toBe(1);
    expect(profile.defaults.topP).toBe(0.95);
    expect(profile.defaults.maxTokens).toBe(8192);
    expect(profile.defaults.stream).toBe(false);
  });
});
