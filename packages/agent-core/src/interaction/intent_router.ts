import { InteractionMode } from "./interaction_modes.js";

export interface IntentClassification {
  mode: InteractionMode;
  confidence: number;
  source: "deterministic" | "context" | "fallback";
  reasons: string[];
  requiresClarification: boolean;
}

export interface RouterContext {
  activeTaskId?: string;
  previousMode?: InteractionMode;
  recentMessages?: string[];
  activeFile?: string;
}

export class IntentRouter {
  /**
   * Deterministic fast classification based on regex and keywords.
   */
  private checkDeterministic(message: string): IntentClassification | null {
    const text = message.trim().toLowerCase();

    // 1. CHAT match
    const chatRegex = /^(hi|hello|hey|how are you|good morning|thanks|thank you)\b/i;
    if (chatRegex.test(text)) {
      return {
        mode: "CHAT",
        confidence: 1.0,
        source: "deterministic",
        reasons: ["greeting or casual phrase detected"],
        requiresClarification: false,
      };
    }

    // 2. ASK match
    const askRegex = /^(explain|how does|what does|why is|search for)\b/i;
    if (askRegex.test(text)) {
      return {
        mode: "ASK",
        confidence: 0.9,
        source: "deterministic",
        reasons: ["explicit investigation/read-only verb detected"],
        requiresClarification: false,
      };
    }

    // 3. PLAN match
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

    // 4. AGENT match
    const agentRegex = /^(fix|implement|refactor|add|update)\b/i;
    if (agentRegex.test(text)) {
      return {
        mode: "AGENT",
        confidence: 0.8,
        source: "deterministic",
        reasons: ["explicit implementation/action verb detected"],
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
   * Main entrypoint for routing an intent.
   */
  public route(message: string, context?: RouterContext): IntentClassification {
    const det = this.checkDeterministic(message);
    if (det) return det;

    const ctx = this.checkContext(message, context);
    if (ctx) return ctx;

    // Fallback to AMBIGUOUS
    return {
      mode: "AMBIGUOUS",
      confidence: 0.0,
      source: "fallback",
      reasons: ["insufficient execution intent"],
      requiresClarification: true,
    };
  }
}
