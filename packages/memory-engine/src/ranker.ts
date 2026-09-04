import { WorkspaceMemoryEntry, MemoryQuery } from "@comu/protocol";
import { MemoryTrustManager } from "./trust.js";
import { MemoryFreshnessManager } from "./freshness.js";

export interface ScoredMemoryEntry {
  entry: WorkspaceMemoryEntry;
  matchScore: number;
  relevanceScore: number;
  trustScore: number;
  freshnessScore: number;
  scopeScore: number;
  matchReason: string;
}

export class MemoryRanker {
  private static readonly STOP_WORDS = new Set([
    "the", "is", "at", "which", "on", "a", "an", "and", "or", "in", "for", "to", "of", "with", "this", "that"
  ]);

  public static tokenize(text: string): string[] {
    if (!text) return [];
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_\-\.\/]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 1 && !this.STOP_WORDS.has(w));
  }

  public static rank(query: MemoryQuery, entries: WorkspaceMemoryEntry[]): ScoredMemoryEntry[] {
    const queryTokens = this.tokenize(query.text || "");
    const queryFiles = new Set((query.files || []).map(f => f.toLowerCase()));

    const scored: ScoredMemoryEntry[] = entries.map(entry => {
      // 1. Relevance Score (Token overlap & BM25 heuristic)
      const contentTokens = this.tokenize(entry.content);
      const contentTokenSet = new Set(contentTokens);

      let matchingTokens = 0;
      for (const qToken of queryTokens) {
        if (contentTokenSet.has(qToken)) {
          matchingTokens++;
        }
      }

      const relevanceScore = queryTokens.length > 0
        ? Math.min(1.0, matchingTokens / queryTokens.length)
        : 0.5;

      // 2. Trust Score (Normalized 0.0 - 1.0)
      const trustRank = MemoryTrustManager.getRank(entry.trustLevel);
      const trustScore = trustRank / 5.0;

      // 3. Freshness Score (Decay 0.0 - 1.0)
      const freshnessScore = MemoryFreshnessManager.calculateFreshnessScore(entry);

      // 4. Scope Score (Files & Branch overlap)
      let scopeScore = 0.5;
      if (entry.scope.files && entry.scope.files.length > 0) {
        const fileMatch = entry.scope.files.some(f => queryFiles.has(f.toLowerCase()));
        scopeScore = fileMatch ? 1.0 : 0.2;
      }
      if (query.branch && entry.scope.branch && query.branch === entry.scope.branch) {
        scopeScore = Math.min(1.0, scopeScore + 0.3);
      }

      // Blended Score
      const matchScore =
        relevanceScore * 0.45 +
        trustScore * 0.30 +
        freshnessScore * 0.15 +
        scopeScore * 0.10;

      const matchReasons: string[] = [];
      if (matchingTokens > 0) {
        matchReasons.push(`${matchingTokens}/${queryTokens.length} query tokens matched`);
      }
      matchReasons.push(`trust: ${entry.trustLevel}`);
      if (entry.status === "STALE") {
        matchReasons.push("stale entry");
      }

      return {
        entry,
        matchScore: Number(matchScore.toFixed(4)),
        relevanceScore: Number(relevanceScore.toFixed(4)),
        trustScore: Number(trustScore.toFixed(4)),
        freshnessScore: Number(freshnessScore.toFixed(4)),
        scopeScore: Number(scopeScore.toFixed(4)),
        matchReason: matchReasons.join("; ")
      };
    });

    // Sort descending by matchScore
    return scored.sort((a, b) => b.matchScore - a.matchScore);
  }
}
