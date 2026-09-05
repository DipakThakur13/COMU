import { TaskContract } from "./task_contract.js";

export class ClarificationHandler {
  /**
   * Generates a user-facing clarification message for an ambiguous request.
   */
  public generateClarificationRequest(message: string): string {
    return "What would you like me to do with it — explain it, review it, plan changes, or make changes?";
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
