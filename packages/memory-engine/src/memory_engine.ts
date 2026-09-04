import crypto from "node:crypto";
import {
  WorkspaceMemoryEntry,
  WorkspaceMemoryType,
  MemoryQuery,
  MemoryQueryResult,
  TaskEpisode
} from "@comu/protocol";
import { MemoryEngineOptions } from "./interfaces.js";
import { MemoryStorage } from "./storage.js";
import { MemorySanitizer } from "./sanitizer.js";
import { MemoryRetriever } from "./retriever.js";
import { MemoryTrustManager } from "./trust.js";

export class MemoryEngine {
  private storage: MemoryStorage;
  private options: MemoryEngineOptions;

  constructor(options?: MemoryEngineOptions) {
    this.options = options || {};
    this.storage = new MemoryStorage(this.options.storageDir);
  }

  private getFilenameForType(type: WorkspaceMemoryType): string {
    switch (type) {
      case "CONVENTION":
        return "conventions.json";
      case "LESSON":
        return "lessons.json";
      case "EPISODE":
        return "episodes.json";
    }
  }

  public async record(
    entryInput: Omit<WorkspaceMemoryEntry, "id" | "createdAt" | "updatedAt" | "contentHash">
  ): Promise<WorkspaceMemoryEntry> {
    const sanitization = MemorySanitizer.sanitize(entryInput.content);
    const sanitizedContent = sanitization.content;

    const contentHash = crypto
      .createHash("sha256")
      .update(sanitizedContent)
      .digest("hex")
      .substring(0, 16);

    const now = new Date().toISOString();
    const filename = this.getFilenameForType(entryInput.type);
    const existingEntries = this.storage.loadEntries(entryInput.workspaceId, filename);

    // Deduplicate by contentHash or update existing
    const existingIndex = existingEntries.findIndex(
      e => e.contentHash === contentHash && e.type === entryInput.type
    );

    let finalEntry: WorkspaceMemoryEntry;

    if (existingIndex >= 0) {
      const existing = existingEntries[existingIndex];
      // Keep higher trust level
      const trustLevel = MemoryTrustManager.isHigherTrust(entryInput.trustLevel, existing.trustLevel)
        ? entryInput.trustLevel
        : existing.trustLevel;

      finalEntry = {
        ...existing,
        content: sanitizedContent,
        trustLevel,
        confidence: Math.max(existing.confidence, entryInput.confidence),
        status: "ACTIVE",
        updatedAt: now,
        verifiedAt: entryInput.verifiedAt || existing.verifiedAt || now,
        evidence: {
          taskId: entryInput.evidence?.taskId || existing.evidence?.taskId,
          files: Array.from(new Set([...(existing.evidence?.files || []), ...(entryInput.evidence?.files || [])])),
          verificationIds: Array.from(
            new Set([...(existing.evidence?.verificationIds || []), ...(entryInput.evidence?.verificationIds || [])])
          ),
          commands: Array.from(
            new Set([...(existing.evidence?.commands || []), ...(entryInput.evidence?.commands || [])])
          )
        }
      };
      existingEntries[existingIndex] = finalEntry;
    } else {
      finalEntry = {
        id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        workspaceId: entryInput.workspaceId,
        type: entryInput.type,
        content: sanitizedContent,
        source: entryInput.source,
        trustLevel: entryInput.trustLevel,
        confidence: entryInput.confidence,
        createdAt: now,
        updatedAt: now,
        verifiedAt: entryInput.verifiedAt,
        status: entryInput.status || "ACTIVE",
        scope: entryInput.scope,
        evidence: entryInput.evidence,
        contentHash
      };
      existingEntries.push(finalEntry);
    }

    this.storage.saveEntries(entryInput.workspaceId, filename, existingEntries);
    return finalEntry;
  }

  public async recordEpisode(episode: TaskEpisode): Promise<void> {
    const sanitization = MemorySanitizer.sanitize(episode.summary);
    const cleanEpisode: TaskEpisode = {
      ...episode,
      summary: sanitization.content
    };
    this.storage.appendEpisode(episode.workspaceId, cleanEpisode);
  }

  public async query(query: MemoryQuery): Promise<MemoryQueryResult> {
    const types: WorkspaceMemoryType[] = query.types || ["CONVENTION", "LESSON"];
    let allEntries: WorkspaceMemoryEntry[] = [];

    for (const type of types) {
      const filename = this.getFilenameForType(type);
      const entries = this.storage.loadEntries(query.workspaceId, filename);
      allEntries = allEntries.concat(entries);
    }

    return MemoryRetriever.retrieve(query, allEntries);
  }

  public async getAll(workspaceId: string): Promise<WorkspaceMemoryEntry[]> {
    const conventions = this.storage.loadEntries(workspaceId, "conventions.json");
    const lessons = this.storage.loadEntries(workspaceId, "lessons.json");
    return [...conventions, ...lessons];
  }

  public async getEpisodes(workspaceId: string): Promise<TaskEpisode[]> {
    return this.storage.loadEpisodes(workspaceId);
  }

  public async invalidate(workspaceId: string, memoryId: string, reason?: string): Promise<boolean> {
    const filenames = ["conventions.json", "lessons.json"];
    let found = false;

    for (const filename of filenames) {
      const entries = this.storage.loadEntries(workspaceId, filename);
      const target = entries.find(e => e.id === memoryId);
      if (target) {
        target.status = "INVALIDATED";
        target.invalidatedAt = new Date().toISOString();
        target.updatedAt = new Date().toISOString();
        this.storage.saveEntries(workspaceId, filename, entries);
        found = true;
        break;
      }
    }

    return found;
  }

  public async delete(workspaceId: string, memoryId: string): Promise<boolean> {
    const filenames = ["conventions.json", "lessons.json"];
    let found = false;

    for (const filename of filenames) {
      const entries = this.storage.loadEntries(workspaceId, filename);
      const filtered = entries.filter(e => e.id !== memoryId);
      if (filtered.length !== entries.length) {
        this.storage.saveEntries(workspaceId, filename, filtered);
        found = true;
        break;
      }
    }

    return found;
  }
}
