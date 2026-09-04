import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { MemoryEngine } from "../src/memory_engine.js";
import { MemorySanitizer } from "../src/sanitizer.js";
import { MemoryTrustManager } from "../src/trust.js";
import { MemoryFreshnessManager } from "../src/freshness.js";

describe("Memory Engine", () => {
  let tempDir: string;
  let engine: MemoryEngine;
  const workspaceId = "test-ws-1";

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `comu-mem-test-${Date.now()}-${Math.random().toString(36).substring(2)}`);
    engine = new MemoryEngine({ storageDir: tempDir });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should sanitize secrets and tokens before persistence", () => {
    const raw = "Configure apiKey: sk-ant-api03-abcdef1234567890abcdef1234567890 and Bearer secrettoken1234567890";
    const result = MemorySanitizer.sanitize(raw);
    expect(result.sanitized).toBe(true);
    expect(result.content).not.toContain("sk-ant");
    expect(result.content).not.toContain("secrettoken1234567890");
    expect(result.content).toContain("[REDACTED");
  });

  it("should enforce trust hierarchy correctly", () => {
    expect(MemoryTrustManager.isHigherTrust("USER_VERIFIED", "AGENT_DERIVED")).toBe(true);
    expect(MemoryTrustManager.isHigherTrust("VERIFIED_EVIDENCE", "AGENT_DERIVED")).toBe(true);
    expect(MemoryTrustManager.isHigherTrust("AGENT_DERIVED", "USER_VERIFIED")).toBe(false);
  });

  it("should record, persist, and query workspace memory entries", async () => {
    const entry = await engine.record({
      workspaceId,
      type: "CONVENTION",
      content: "This project uses Vitest for testing and PNPM for package management.",
      source: "USER",
      trustLevel: "USER_VERIFIED",
      confidence: 1.0,
      scope: { workspaceId }
    });

    expect(entry.id).toBeDefined();
    expect(entry.contentHash).toBeDefined();

    const queryResult = await engine.query({
      workspaceId,
      text: "vitest test runner pnpm",
      limit: 3
    });

    expect(queryResult.entries.length).toBe(1);
    expect(queryResult.entries[0].content).toContain("Vitest");
    expect(queryResult.explanations[0].trustScore).toBe(1.0);
    expect(queryResult.explanations[0].isStale).toBe(false);
  });

  it("should resolve conflicts in favor of higher trust entries", async () => {
    // Agent derived lower trust entry
    await engine.record({
      workspaceId,
      type: "CONVENTION",
      content: "This project uses Jest as the test runner.",
      source: "AGENT",
      trustLevel: "AGENT_DERIVED",
      confidence: 0.6,
      scope: { workspaceId }
    });

    // User verified higher trust entry on the same topic
    await engine.record({
      workspaceId,
      type: "CONVENTION",
      content: "This project uses Vitest as the test runner.",
      source: "USER",
      trustLevel: "USER_VERIFIED",
      confidence: 1.0,
      scope: { workspaceId }
    });

    const res = await engine.query({
      workspaceId,
      text: "test runner"
    });

    // The user verified Vitest entry should win and be ranked first
    expect(res.entries.length).toBeGreaterThanOrEqual(1);
    expect(res.entries[0].content).toContain("Vitest");
    expect(res.entries[0].trustLevel).toBe("USER_VERIFIED");
  });

  it("should invalidate memory and prevent it from being queried", async () => {
    const entry = await engine.record({
      workspaceId,
      type: "LESSON",
      content: "Always run npm install before building.",
      source: "TASK_VERIFIED",
      trustLevel: "TASK_VERIFIED",
      confidence: 0.8,
      scope: { workspaceId }
    });

    const invalidated = await engine.invalidate(workspaceId, entry.id, "Deprecated command");
    expect(invalidated).toBe(true);

    const res = await engine.query({
      workspaceId,
      text: "npm install building"
    });

    expect(res.entries.some(e => e.id === entry.id)).toBe(false);
  });

  it("should handle corrupted storage gracefully without crashing", async () => {
    // Write corrupted JSON
    const memDir = (engine as any).storage.getWorkspaceMemoryDir(workspaceId);
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "conventions.json"), "{ invalid JSON content !!!", "utf8");

    const entries = await engine.getAll(workspaceId);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(0);
  });
});
