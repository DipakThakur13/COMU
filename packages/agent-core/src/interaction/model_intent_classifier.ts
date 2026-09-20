import { ModelProvider, ModelRequestManager } from "@comu/model-core";
import { AgentEvent } from "@comu/protocol";
import { IntentClassification } from "./intent_router.js";
import { InteractionMode } from "./interaction_modes.js";

const VALID_MODES: InteractionMode[] = ["CHAT", "ASK", "PLAN", "AGENT", "AMBIGUOUS"];

export const INTENT_CLASSIFIER_SYSTEM_PROMPT = [
  "You classify a developer's message to an AI software engineer inside VS Code into exactly one interaction mode.",
  "Modes:",
  "- CHAT: greetings, small talk, thanks, or general conversation with no request about the codebase.",
  "- ASK: the user wants information, explanation, review, or investigation. Nothing should be modified.",
  "- PLAN: the user wants a plan, design, proposal, or approach, but not the changes themselves yet.",
  "- AGENT: the user wants code, files, tests, configuration, or the repository changed, fixed, built, run, or created.",
  "- AMBIGUOUS: only when the message genuinely cannot be assigned (for example a bare pointer like 'this one' with no request).",
  "Politeness prefixes such as 'please', 'could you', 'I need you to' carry no meaning; classify the underlying request.",
  "Reply with a single JSON object and nothing else: {\"mode\": \"CHAT|ASK|PLAN|AGENT|AMBIGUOUS\", \"confidence\": 0.0-1.0, \"reason\": \"short\"}"
].join("\n");

export interface ModelIntentClassifierOptions {
  /** Below this confidence the result is treated as AMBIGUOUS. */
  minConfidence?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

/**
 * Cheap model-backed intent classification used only when the deterministic router cannot decide.
 * Any failure (provider error, timeout, unparseable reply) degrades to AMBIGUOUS so the caller can
 * ask the user rather than guess.
 */
export class ModelIntentClassifier {
  private readonly minConfidence: number;
  private readonly requestManager: ModelRequestManager;

  constructor(
    private readonly model: ModelProvider,
    onEvent: (event: AgentEvent) => void,
    options: ModelIntentClassifierOptions = {}
  ) {
    this.minConfidence = options.minConfidence ?? 0.6;
    this.requestManager = new ModelRequestManager(model, onEvent, {
      modelRequestTimeoutMs: options.timeoutMs ?? 30_000,
      maxAttempts: options.maxAttempts ?? 2,
      maxRetryTimeMs: 15_000
    });
  }

  public static parseReply(text: string | undefined): { mode: InteractionMode; confidence: number; reason?: string } | null {
    if (!text) return null;
    const cleaned = text.replace(/<(think|thought)>[\s\S]*?<\/\1>/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      const mode = String(parsed.mode || "").toUpperCase() as InteractionMode;
      if (!VALID_MODES.includes(mode)) return null;
      const confidenceRaw = Number(parsed.confidence);
      const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0;
      return { mode, confidence, reason: typeof parsed.reason === "string" ? parsed.reason : undefined };
    } catch {
      return null;
    }
  }

  public async classify(message: string, taskId: string, runId: string, signal?: AbortSignal): Promise<IntentClassification> {
    if (!this.model || typeof this.model.generate !== "function") {
      return this.ambiguous("no model provider available for classification");
    }

    let text: string | undefined;
    try {
      const response = await this.requestManager.execute(
        taskId,
        runId,
        {
          prompt: message,
          systemPrompt: INTENT_CLASSIFIER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: message }],
          temperature: 0,
          maxTokens: 120
        },
        signal
      );
      text = response.text;
    } catch (err: any) {
      if (signal?.aborted) throw err;
      return this.ambiguous(`model classification failed: ${err?.message || String(err)}`);
    }

    const parsed = ModelIntentClassifier.parseReply(text);
    if (!parsed) {
      return this.ambiguous("model classification reply was not parseable");
    }

    if (parsed.mode === "AMBIGUOUS" || parsed.confidence < this.minConfidence) {
      return {
        mode: "AMBIGUOUS",
        confidence: parsed.confidence,
        source: "model",
        reasons: [parsed.reason || `model confidence ${parsed.confidence.toFixed(2)} below ${this.minConfidence}`],
        requiresClarification: true
      };
    }

    return {
      mode: parsed.mode,
      confidence: parsed.confidence,
      source: "model",
      reasons: [parsed.reason || "model classification"],
      requiresClarification: false
    };
  }

  private ambiguous(reason: string): IntentClassification {
    return {
      mode: "AMBIGUOUS",
      confidence: 0,
      source: "fallback",
      reasons: [reason],
      requiresClarification: true
    };
  }
}
