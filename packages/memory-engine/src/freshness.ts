import { WorkspaceMemoryEntry, MemoryStatus } from "@comu/protocol";

export class MemoryFreshnessManager {
  // Half-life of memory relevance in days (30 days default)
  private static readonly HALF_LIFE_DAYS = 30;

  public static calculateFreshnessScore(entry: WorkspaceMemoryEntry, now: Date = new Date()): number {
    if (entry.status === "INVALIDATED") {
      return 0.0;
    }

    const referenceDateStr = entry.verifiedAt || entry.updatedAt || entry.createdAt;
    const refTime = new Date(referenceDateStr).getTime();
    const elapsedDays = Math.max(0, (now.getTime() - refTime) / (1000 * 60 * 60 * 24));

    // Exponential decay: e^(-lambda * t)
    const lambda = Math.LN2 / this.HALF_LIFE_DAYS;
    let score = Math.exp(-lambda * elapsedDays);

    if (entry.status === "STALE") {
      score *= 0.5;
    }

    return Math.max(0.01, Math.min(1.0, score));
  }

  public static evaluateStatus(entry: WorkspaceMemoryEntry, maxAgeDays: number = 60): MemoryStatus {
    if (entry.status === "INVALIDATED") {
      return "INVALIDATED";
    }

    const referenceDateStr = entry.verifiedAt || entry.updatedAt || entry.createdAt;
    const elapsedDays = (Date.now() - new Date(referenceDateStr).getTime()) / (1000 * 60 * 60 * 24);

    if (elapsedDays > maxAgeDays) {
      return "STALE";
    }

    return "ACTIVE";
  }
}
