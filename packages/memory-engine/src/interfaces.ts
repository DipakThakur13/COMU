import {
  WorkspaceMemoryEntry,
  WorkspaceMemoryType,
  MemoryTrustLevel,
  MemoryStatus,
  MemorySource,
  TaskEpisode
} from "@comu/protocol";

export interface MemoryEngineOptions {
  storageDir?: string;
  maxEntriesPerType?: number;
  maxQueryResults?: number;
  enableSanitization?: boolean;
}

export interface SanitizationResult {
  content: string;
  sanitized: boolean;
  redactedPatterns: string[];
}

export interface MemoryConflictResolution {
  winner: WorkspaceMemoryEntry;
  suppressed: WorkspaceMemoryEntry[];
  reason: string;
}
