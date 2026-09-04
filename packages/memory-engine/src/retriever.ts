import {
  WorkspaceMemoryEntry,
  MemoryQuery,
  MemoryQueryResult,
  MemoryRetrievalExplanation
} from "@comu/protocol";
import { MemoryTrustManager } from "./trust.js";
import { MemoryRanker } from "./ranker.js";

export class MemoryRetriever {
  public static retrieve(query: MemoryQuery, allEntries: WorkspaceMemoryEntry[]): MemoryQueryResult {
    const limit = query.limit || 5;

    // 1. Filter by workspace and status
    let candidates = allEntries.filter(e => {
      if (e.workspaceId !== query.workspaceId) {
        return false;
      }
      if (e.status === "INVALIDATED") {
        return false;
      }
      if (query.types && query.types.length > 0 && !query.types.includes(e.type)) {
        return false;
      }
      if (query.minTrust && !MemoryTrustManager.isAtLeast(e.trustLevel, query.minTrust)) {
        return false;
      }
      return true;
    });

    // 2. Conflict resolution (deduplicate / suppress lower-trust conflicting entries)
    candidates = this.resolveConflicts(candidates);

    // 3. Rank entries
    const scored = MemoryRanker.rank(query, candidates);

    // 4. Bound top-K
    const topScored = scored.slice(0, limit);

    const explanations: MemoryRetrievalExplanation[] = topScored.map(s => ({
      entry: s.entry,
      matchScore: s.matchScore,
      relevanceScore: s.relevanceScore,
      trustScore: s.trustScore,
      freshnessScore: s.freshnessScore,
      matchReason: s.matchReason,
      isStale: s.entry.status === "STALE"
    }));

    return {
      entries: topScored.map(s => s.entry),
      explanations
    };
  }

  private static resolveConflicts(entries: WorkspaceMemoryEntry[]): WorkspaceMemoryEntry[] {
    // Group entries by normalized content hash or specific key topics
    const byScopeContent = new Map<string, WorkspaceMemoryEntry>();

    for (const entry of entries) {
      const scopeKey = `${entry.type}:${(entry.scope.files || []).sort().join(",")}:${entry.content.slice(0, 40).toLowerCase()}`;
      const existing = byScopeContent.get(scopeKey);

      if (!existing) {
        byScopeContent.set(scopeKey, entry);
      } else {
        // Compare trust
        if (MemoryTrustManager.isHigherTrust(entry.trustLevel, existing.trustLevel)) {
          byScopeContent.set(scopeKey, entry);
        } else if (entry.trustLevel === existing.trustLevel) {
          // If trust equal, prefer newer
          const existingTime = new Date(existing.verifiedAt || existing.updatedAt || existing.createdAt).getTime();
          const entryTime = new Date(entry.verifiedAt || entry.updatedAt || entry.createdAt).getTime();
          if (entryTime > existingTime) {
            byScopeContent.set(scopeKey, entry);
          }
        }
      }
    }

    return Array.from(byScopeContent.values());
  }
}
