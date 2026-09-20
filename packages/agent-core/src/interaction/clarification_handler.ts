import { TaskContract } from "./task_contract.js";
import { InteractionMode } from "./interaction_modes.js";

/** Options offered in the clarification card, in display order, with the mode each one selects. */
export const CLARIFICATION_OPTIONS: ReadonlyArray<{ label: string; mode: InteractionMode }> = [
  { label: "Explain it", mode: "ASK" },
  { label: "Review it", mode: "ASK" },
  { label: "Plan changes", mode: "PLAN" },
  { label: "Make changes", mode: "AGENT" }
];

export class ClarificationHandler {
  /**
   * Generates a user-facing clarification message for an ambiguous request.
   */
  public generateClarificationRequest(_message: string): string {
    return "What would you like me to do with it — explain it, review it, plan changes, or make changes?";
  }

  public getOptions(): string[] {
    return CLARIFICATION_OPTIONS.map(o => o.label);
  }

  /** Maps a chosen option back to a mode; free-text answers return undefined and are re-routed. */
  public mapAnswerToMode(answer: string | undefined): InteractionMode | undefined {
    const normalized = (answer || "").trim().toLowerCase();
    if (!normalized) return undefined;
    return CLARIFICATION_OPTIONS.find(o => o.label.toLowerCase() === normalized)?.mode;
  }

  /**
   * Validates if the current state safely allows entering clarification.
   */
  public canAskClarification(contract?: TaskContract): boolean {
    if (contract && contract.mode !== "AMBIGUOUS") {
      return false; // Already executing a non-ambiguous task
    }
    return true;
  }
}
