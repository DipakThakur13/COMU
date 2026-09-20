import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Server } from "http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModelProvider, ModelResponse } from "@comu/model-core";
import { DEFAULT_AGENT_LIMITS, createRuntimeApp, resolveTaskLimits } from "../src/server";

/**
 * The execution budget is a parameter, not a constant.
 *
 * Five minutes is right for someone watching a panel and wrong for a long refactor. While the
 * budget was hardcoded, any measurement of a long task measured the timeout rather than the agent,
 * and no improvement to context or planning could show against it. These tests pin the two
 * properties that matter: the shipped defaults still apply when nobody asks for anything, and a
 * caller cannot ask for something absurd.
 */

describe("Defaults", () => {
  it("keeps the values COMU has always shipped", () => {
    expect(DEFAULT_AGENT_LIMITS).toEqual({
      maxSteps: 30,
      maxToolCalls: 100,
      maxExecutionTimeMs: 300_000,
      maxRepairAttempts: 3,
      maxValidationRuns: 6,
      maxRepairFiles: 5,
      maxRepairTimeMs: 180_000
    });
  });

  it("applies them when the caller says nothing", () => {
    for (const absent of [undefined, null]) {
      const resolved = resolveTaskLimits(absent);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(resolved.limits).toEqual(DEFAULT_AGENT_LIMITS);
    }
  });

  it("returns a copy, so one task cannot change the budget of the next", () => {
    const first = resolveTaskLimits(undefined);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    (first.limits as { maxSteps: number }).maxSteps = 999;
    const second = resolveTaskLimits(undefined);
    if (second.ok) expect(second.limits.maxSteps).toBe(30);
  });
});

describe("Overrides", () => {
  it("merges over the defaults rather than replacing them", () => {
    const resolved = resolveTaskLimits({ maxExecutionTimeMs: 1_800_000 });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.limits.maxExecutionTimeMs).toBe(1_800_000);
    // Everything the caller did not mention is untouched.
    expect(resolved.limits.maxSteps).toBe(30);
    expect(resolved.limits.maxToolCalls).toBe(100);
  });

  it("accepts every field it documents", () => {
    const all = {
      maxSteps: 200,
      maxToolCalls: 800,
      maxExecutionTimeMs: 1_200_000,
      maxRepairAttempts: 5,
      maxValidationRuns: 10,
      maxRepairFiles: 12,
      maxRepairTimeMs: 600_000
    };
    const resolved = resolveTaskLimits(all);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.limits).toEqual(all);
  });
});

describe("What a caller may not ask for", () => {
  it("refuses a limit that is not a positive integer", () => {
    for (const bad of [0, -1, 1.5, "30", true, null, NaN]) {
      const resolved = resolveTaskLimits({ maxSteps: bad });
      expect(resolved.ok, `maxSteps: ${String(bad)}`).toBe(false);
      if (!resolved.ok) expect(resolved.message).toContain("positive integer");
    }
  });

  it("refuses a limit past its ceiling, so an overridable limit is still a limit", () => {
    const resolved = resolveTaskLimits({ maxExecutionTimeMs: 24 * 60 * 60 * 1000 });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.message).toMatch(/must not exceed/);
  });

  it("accepts a value exactly at the ceiling", () => {
    expect(resolveTaskLimits({ maxSteps: 1000 }).ok).toBe(true);
    expect(resolveTaskLimits({ maxSteps: 1001 }).ok).toBe(false);
  });

  it("refuses an unknown key rather than ignoring it", () => {
    // Silently dropping a misspelled budget is how a benchmark ends up measuring the default while
    // believing it raised the limit.
    const resolved = resolveTaskLimits({ maxStep: 200 });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.message).toContain("Unknown limit 'maxStep'");
  });

  it("refuses a non-object", () => {
    for (const bad of [42, "limits", [1, 2]]) {
      expect(resolveTaskLimits(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("names the approval fields as unknown, because they are the server's to set", () => {
    // approvalTimeoutMs decides whether a human's silence denies an action. A task request must
    // not be able to shorten it.
    expect(resolveTaskLimits({ approvalTimeoutMs: 1 }).ok).toBe(false);
    expect(resolveTaskLimits({ approvalObserverGraceMs: 1 }).ok).toBe(false);
  });
});

// ── Over the wire ────────────────────────────────────────────────────────────

class StubModel implements ModelProvider {
  id = "stub";
  name = "Stub";
  getCapabilities() {
    return { toolCalling: true, streaming: false, reasoning: false, vision: false, structuredOutput: true, maxContextTokens: 8000 };
  }
  async generate(): Promise<ModelResponse> {
    return { text: "Done." };
  }
}

describe("POST /v1/tasks", () => {
  let server: Server;
  let baseUrl: string;
  let workspace: string;

  beforeAll(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "comu-limits-"));
    const app = createRuntimeApp({ providerFactory: () => new StubModel() });
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        resolve();
      });
    });
    await fetch(`${baseUrl}/v1/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { "stub-model": { apiKey: "test-only" } } })
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const start = (limits?: unknown) =>
    fetch(`${baseUrl}/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "do nothing",
        modelId: "stub-model",
        mode: "CHAT",
        workspace: { rootPath: workspace },
        ...(limits === undefined ? {} : { limits })
      })
    });

  it("reports the budget it resolved, so a measured run knows what it ran under", async () => {
    const res = await start();
    expect(res.status).toBe(201);
    expect((await res.json()).limits).toEqual(DEFAULT_AGENT_LIMITS);
  });

  it("honours a raised budget and echoes it back", async () => {
    const res = await start({ maxExecutionTimeMs: 1_800_000, maxSteps: 120 });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.limits.maxExecutionTimeMs).toBe(1_800_000);
    expect(body.limits.maxSteps).toBe(120);
    expect(body.limits.maxToolCalls).toBe(DEFAULT_AGENT_LIMITS.maxToolCalls);
  });

  it("rejects an invalid budget with a reason rather than silently using the default", async () => {
    const res = await start({ maxSteps: -1 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_LIMITS");
    expect(body.message).toContain("positive integer");
  });

  it("rejects a misspelled budget key", async () => {
    const res = await start({ maxExecutionTimeMS: 600_000 });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_LIMITS");
  });
});
