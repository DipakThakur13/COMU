import { InteractionMode } from "./interaction_modes.js";

export interface IntentClassification {
  mode: InteractionMode;
  confidence: number;
  source: "explicit" | "deterministic" | "context" | "model" | "fallback";
  reasons: string[];
  requiresClarification: boolean;
}

export interface RouterContext {
  activeTaskId?: string;
  previousMode?: InteractionMode;
  recentMessages?: string[];
  activeFile?: string;
}

/** Anything a model could be asked to classify on demand. */
export interface IntentClassifier {
  classify(message: string, taskId: string, runId: string, signal?: AbortSignal): Promise<IntentClassification>;
}

/**
 * Leading politeness and framing carry no intent. "please fix the login bug" must classify exactly
 * like "fix the login bug". Applied repeatedly so "hey comu, could you please add ..." also collapses.
 */
const POLITENESS_PREFIX = /^(?:(?:hey|hi|hello|ok|okay)[,!]?\s+)?(?:comu[,:]?\s+)?(?:please|kindly|can you|could you|would you|will you|would you mind|i need you to|i want you to|i'd like you to|i would like you to|i need to|i want to|i'd like to|i would like to|let's|lets|go ahead and|just)\s+/i;

export function stripPoliteness(message: string): string {
  let text = message.trim();
  for (let i = 0; i < 4; i++) {
    const next = text.replace(POLITENESS_PREFIX, "");
    if (next === text) break;
    text = next.trim();
  }
  return text;
}

export class IntentRouter {
  /**
   * Deterministic fast classification based on regex and keywords.
   */
  private checkDeterministic(message: string): IntentClassification | null {
    const original = message.trim().toLowerCase();
    const text = stripPoliteness(original);

    // Greetings are matched on the untouched message: "hi" alone is CHAT, but the "hi" in
    // "hi, please fix the bug" is only a prefix.
    const chatRegex = /^(hi|hello|hey|how are you|good morning|thanks|thank you)\b/i;
    if (text === original && chatRegex.test(original)) {
      return {
        mode: "CHAT",
        confidence: 1.0,
        source: "deterministic",
        reasons: ["greeting or casual phrase detected"],
        requiresClarification: false,
      };
    }

    // 2. PLAN match (checked before askRegex so 'give me a plan' matches PLAN)
    const planRegex = /^(plan|give me a plan|how would you)\b/i;
    if (planRegex.test(text)) {
      return {
        mode: "PLAN",
        confidence: 0.9,
        source: "deterministic",
        reasons: ["explicit planning request detected"],
        requiresClarification: false,
      };
    }

    // 3. ASK match
    const askRegex = /^(explain|how does|what does|why is|why did|why does|why\b|search for|what is|where is|describe|show|give|tell|find|inspect|sample)\b/i;
    if (askRegex.test(text)) {
      return {
        mode: "ASK",
        confidence: 0.9,
        source: "deterministic",
        reasons: ["explicit investigation/read-only verb detected"],
        requiresClarification: false,
      };
    }

    // 4. Ambiguous pointers without context
    const ambiguousRegex = /^(take a look|look at this|look into this|check this out|check this\b|what do you think)\b/i;
    if (ambiguousRegex.test(text)) {
      return {
        mode: "AMBIGUOUS",
        confidence: 0.9,
        source: "deterministic",
        reasons: ["ambiguous pointer phrase detected without target context"],
        requiresClarification: true,
      };
    }

    // 5. AGENT match (broad engineering action verbs and keywords)
    const agentRegex = /^(fix|implement|refactor|add|update|create|delete|remove|run|test|build|check|modify|write|verify|investigate|repair|do|scenario|e2e|break|task|debug)\b/i;
    const engineeringKeywords = /\b(fail|failing|broken|bug|error|tests?|issue|repair|patch|changes?|edits?|mutation|refactor|benchmark|cancellation|e2e|prompt)\b/i;
    if (agentRegex.test(text) || engineeringKeywords.test(text)) {
      return {
        mode: "AGENT",
        confidence: 0.8,
        source: "deterministic",
        reasons: ["explicit implementation/action verb or engineering keyword detected"],
        requiresClarification: false,
      };
    }

    return null; // Fallthrough
  }

  /**
   * Context-aware classification when deterministic fails or needs reinforcement.
   */
  private checkContext(message: string, context?: RouterContext): IntentClassification | null {
    if (!context) return null;

    const text = message.trim().toLowerCase();

    // Follow-ups inherit intent context but might downgrade if asking a question
    if (context.previousMode === "AGENT") {
      if (text.startsWith("why") || text.includes("explain")) {
        return {
          mode: "ASK",
          confidence: 0.8,
          source: "context",
          reasons: ["question follow-up in AGENT context"],
          requiresClarification: false,
        };
      }
      if (text.startsWith("also")) {
        return {
          mode: "AGENT",
          confidence: 0.8,
          source: "context",
          reasons: ["additive follow-up in AGENT context"],
          requiresClarification: false,
        };
      }
    }

    // If active file is present and user says something ambiguous like "review it"
    if (context.activeFile && text.includes("review")) {
      return {
        mode: "ASK",
        confidence: 0.7,
        source: "context",
        reasons: ["review request with active file context"],
        requiresClarification: false,
      };
    }

    return null;
  }

  /**
   * Synchronous routing: context, then deterministic rules, then AMBIGUOUS.
   */
  public route(message: string, context?: RouterContext): IntentClassification {
    const ctx = this.checkContext(message, context);
    if (ctx) return ctx;

    const det = this.checkDeterministic(message);
    if (det) return det;

    // Fallback to AMBIGUOUS
    return {
      mode: "AMBIGUOUS",
      confidence: 0.0,
      source: "fallback",
      reasons: ["insufficient execution intent"],
      requiresClarification: true,
    };
  }

  /**
   * Routing with a model fallback. The deterministic fast path decides obvious cases for free;
   * only messages it cannot place are sent to the classifier. A deterministic AMBIGUOUS (a bare
   * pointer such as "take a look at this") is kept as-is because no classifier can resolve a
   * missing target. AMBIGUOUS is therefore reserved for genuine uncertainty.
   */
  public async routeWithFallback(
    message: string,
    context: RouterContext | undefined,
    classifier: IntentClassifier | undefined,
    ids: { taskId: string; runId: string },
    signal?: AbortSignal
  ): Promise<IntentClassification> {
    const ctx = this.checkContext(message, context);
    if (ctx) return ctx;

    const det = this.checkDeterministic(message);
    if (det) return det;

    if (classifier) {
      return classifier.classify(message, ids.taskId, ids.runId, signal);
    }

    return {
      mode: "AMBIGUOUS",
      confidence: 0.0,
      source: "fallback",
      reasons: ["insufficient execution intent and no classifier available"],
      requiresClarification: true,
    };
  }
}
