import { OpenAICompatibleProvider } from "./openai_provider.js";
import { OLLAMA_CAPABILITY_PROFILE } from "./profiles/ollama.js";
import { ProviderTestResult } from "@comu/protocol";

export interface OllamaModelInfo {
  /** COMU model id, always prefixed so provider selection is unambiguous, e.g. `ollama:llama3.1:8b`. */
  id: string;
  /** Raw Ollama model name as reported by `/api/tags`, e.g. `llama3.1:8b`. */
  name: string;
  sizeBytes?: number;
  parameterSize?: string;
  family?: string;
}

/**
 * Local Ollama provider. Uses Ollama's OpenAI-compatible chat endpoint for inference and its
 * native `/api/tags` endpoint for reachability and model discovery. No API key is ever sent.
 */
export class OllamaProvider extends OpenAICompatibleProvider {
  public static readonly DEFAULT_BASE_URL = "http://127.0.0.1:11434";
  public static readonly MODEL_ID_PREFIX = "ollama:";
  public static readonly DEFAULT_MODEL = "llama3.1";

  public readonly baseUrl: string;

  constructor(endpoint?: string, modelId?: string) {
    const baseUrl = OllamaProvider.normalizeBaseUrl(endpoint);
    super(undefined, `${baseUrl}/v1`, OllamaProvider.toOllamaModelName(modelId), OLLAMA_CAPABILITY_PROFILE);
    this.baseUrl = baseUrl;
    this.id = "ollama";
    this.providerId = "ollama";
    this.name = "Ollama";
    this.displayName = "Ollama (Local)";
  }

  /** Resolves the daemon base URL: explicit endpoint, then OLLAMA_HOST, then the default. */
  public static normalizeBaseUrl(endpoint?: string): string {
    let raw = (endpoint || "").trim() || (process.env.OLLAMA_HOST || "").trim() || OllamaProvider.DEFAULT_BASE_URL;
    if (!/^https?:\/\//i.test(raw)) {
      raw = `http://${raw}`;
    }
    raw = raw.replace(/\/+$/, "");
    raw = raw.replace(/\/chat\/completions$/i, "");
    raw = raw.replace(/\/v1$/i, "");
    return raw;
  }

  /** True when a COMU model id addresses Ollama. */
  public static isOllamaModelId(modelId: string | undefined): boolean {
    const lower = (modelId || "").toLowerCase();
    return lower.startsWith(OllamaProvider.MODEL_ID_PREFIX) || lower.startsWith("ollama-") || lower === "ollama" || lower.includes("local");
  }

  /**
   * Maps a COMU model id to the model name Ollama expects.
   *   `ollama:qwen2.5-coder:7b` -> `qwen2.5-coder:7b`
   *   `ollama-llama-3` (legacy id) -> `llama3`
   *   undefined -> default model
   */
  public static toOllamaModelName(modelId?: string): string {
    const raw = (modelId || "").trim();
    if (!raw) return OllamaProvider.DEFAULT_MODEL;
    const lower = raw.toLowerCase();
    if (lower.startsWith(OllamaProvider.MODEL_ID_PREFIX)) {
      const name = raw.slice(OllamaProvider.MODEL_ID_PREFIX.length).trim();
      return name || OllamaProvider.DEFAULT_MODEL;
    }
    if (lower === "ollama-llama-3" || lower === "ollama-local" || lower === "ollama") {
      return lower === "ollama-llama-3" ? "llama3" : OllamaProvider.DEFAULT_MODEL;
    }
    if (lower.startsWith("ollama-")) {
      return raw.slice("ollama-".length);
    }
    return raw;
  }

  public static toComuModelId(ollamaName: string): string {
    return `${OllamaProvider.MODEL_ID_PREFIX}${ollamaName}`;
  }

  /** Lists installed models via the native `/api/tags` endpoint. Throws if the daemon is unreachable. */
  public static async listModels(endpoint?: string, timeoutMs = 2000): Promise<OllamaModelInfo[]> {
    const baseUrl = OllamaProvider.normalizeBaseUrl(endpoint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Ollama /api/tags returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as any;
      const models: any[] = Array.isArray(data?.models) ? data.models : [];
      return models
        .filter(m => m && typeof m.name === "string")
        .map(m => ({
          id: OllamaProvider.toComuModelId(m.name),
          name: m.name,
          sizeBytes: typeof m.size === "number" ? m.size : undefined,
          parameterSize: m.details?.parameter_size,
          family: m.details?.family
        }));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Real reachability check against the local daemon. Never contacts any remote host.
   * (Named `probe` because the inherited static `testConnection` has a different signature.)
   */
  public static async probe(endpoint?: string, timeoutMs = 2000): Promise<ProviderTestResult> {
    const baseUrl = OllamaProvider.normalizeBaseUrl(endpoint);
    const startTime = Date.now();
    try {
      const models = await OllamaProvider.listModels(baseUrl, timeoutMs);
      const latencyMs = Date.now() - startTime;
      if (models.length === 0) {
        return {
          provider: "ollama",
          status: "CONNECTED",
          latencyMs,
          message: `Ollama is running at ${baseUrl} but no models are installed. Run \`ollama pull ${OllamaProvider.DEFAULT_MODEL}\`.`
        };
      }
      return {
        provider: "ollama",
        status: "CONNECTED",
        model: models[0].name,
        latencyMs,
        message: `${models.length} local model${models.length === 1 ? "" : "s"} available.`
      };
    } catch (err: any) {
      const timedOut = err?.name === "AbortError";
      return {
        provider: "ollama",
        status: timedOut ? "TIMEOUT" : "CONNECTION_ERROR",
        message: timedOut
          ? `Ollama did not respond at ${baseUrl} within ${Math.round(timeoutMs / 1000)}s.`
          : `Could not reach Ollama at ${baseUrl}. Install it from https://ollama.com and make sure \`ollama serve\` is running.`
      };
    }
  }

  public async testConnection(): Promise<ProviderTestResult> {
    return OllamaProvider.probe(this.baseUrl);
  }
}
