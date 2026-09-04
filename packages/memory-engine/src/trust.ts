import { MemoryTrustLevel, MemorySource } from "@comu/protocol";

export class MemoryTrustManager {
  private static readonly TRUST_RANKS: Record<MemoryTrustLevel, number> = {
    USER_VERIFIED: 5,
    VERIFIED_EVIDENCE: 4,
    TASK_VERIFIED: 3,
    AGENT_DERIVED: 2,
    UNVERIFIED: 1
  };

  public static getRank(level: MemoryTrustLevel): number {
    return this.TRUST_RANKS[level] || 1;
  }

  public static isHigherTrust(a: MemoryTrustLevel, b: MemoryTrustLevel): boolean {
    return this.getRank(a) > this.getRank(b);
  }

  public static isAtLeast(level: MemoryTrustLevel, threshold: MemoryTrustLevel): boolean {
    return this.getRank(level) >= this.getRank(threshold);
  }

  public static resolveTrustLevel(source: MemorySource, hasVerifiedEvidence: boolean): MemoryTrustLevel {
    if (source === "USER") {
      return "USER_VERIFIED";
    }
    if (source === "VERIFICATION" && hasVerifiedEvidence) {
      return "VERIFIED_EVIDENCE";
    }
    if (source === "TOOL" && hasVerifiedEvidence) {
      return "TASK_VERIFIED";
    }
    if (source === "AGENT") {
      return "AGENT_DERIVED";
    }
    return "UNVERIFIED";
  }
}
