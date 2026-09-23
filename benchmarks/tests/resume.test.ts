import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveTaskLimits } from "../../apps/agent-runtime/src/server.js";
import { describeLimitDifferences, limitDifferences } from "../src/resume.js";
import { appendMixedLimitsMarker, appendRecord, readJournal, readJournalMarkers, renderMarkdown } from "../src/report.js";
import type { RunRecord } from "../src/types.js";

/**
 * A resume must measure under the budget the journal was measured under.
 *
 * B0 was resumed without its --limits, so the runtime's defaults (30 steps, 5 minutes, 120 seconds
 * per request) silently replaced 60, 25 minutes and 600 seconds, and ten cells died on their first
 * slow request.
 */

const B0_LIMITS = {
  maxSteps: 60,
  maxToolCalls: 200,
  maxExecutionTimeMs: 1_500_000,
  maxRepairAttempts: 3,
  maxValidationRuns: 6,
  maxRepairFiles: 5,
  maxRepairTimeMs: 180_000,
  modelRequestTimeoutMs: 600_000
};

const defaults = (): Record<string, number> => {
  const resolved = resolveTaskLimits(undefined);
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.limits as unknown as Record<string, number>;
};

const record = (over: Partial<RunRecord>): RunRecord =>
  ({
    fixtureId: "t1-ts-currency",
    tier: "T1",
    ecosystem: "typescript",
    rep: 1,
    model: { id: "m", provider: "p" },
    limits: B0_LIMITS,
    startedAt: "2026-09-20T00:00:00.000Z",
    durationMs: 1000,
    comuStatus: "completed",
    grader: { correct: true, reason: "", regressions: [], stillFailing: [] },
    falseCompletion: false,
    falseFailure: false,
    unnecessaryChanges: [],
    filesChanged: [],
    approvalsRequested: 0,
    clarificationsRequested: 0,
    toolCalls: 0,
    modelRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    peakPromptTokens: 0,
    contextWindow: 1000,
    peakContextRatio: 0,
    planSteps: 0,
    planVersions: 0,
    repairAttempts: 0,
    repairRecovered: false,
    providerFailures: { timeouts: 0, rateLimits: 0, gateway: 0, other: 0 },
    failureClass: null,
    ...over
  }) as RunRecord;

describe("limitDifferences", () => {
  it("finds the B0 case: no --limits on resume compares as the runtime's defaults", () => {
    const differences = limitDifferences([record({})], () => defaults());
    const keys = differences.map(d => d.key).sort();
    expect(keys).toEqual(["maxExecutionTimeMs", "maxSteps", "maxToolCalls", "modelRequestTimeoutMs"]);
    const timeout = differences.find(d => d.key === "modelRequestTimeoutMs");
    expect(timeout).toMatchObject({ recorded: 600_000, incoming: defaults().modelRequestTimeoutMs });
  });

  it("finds nothing when the resume repeats the journal's limits", () => {
    expect(limitDifferences([record({})], () => ({ ...B0_LIMITS }))).toEqual([]);
  });

  it("ignores a run that never reached the runtime and so recorded no budget", () => {
    expect(limitDifferences([record({ limits: {} })], () => defaults())).toEqual([]);
  });

  it("ignores fixtures this invocation does not run", () => {
    expect(limitDifferences([record({})], () => undefined)).toEqual([]);
  });

  it("reports one change once however many records share it, and names the fixtures", () => {
    const records = [record({ rep: 1 }), record({ rep: 2 }), record({ fixtureId: "t2-py-validator" })];
    const differences = limitDifferences(records, () => ({ ...B0_LIMITS, maxSteps: 30 }));
    expect(differences).toHaveLength(2);
    expect(describeLimitDifferences(differences)).toEqual(["  maxSteps: journal 60, this run 30 (2 fixtures)"]);
  });
});

describe("the mixed-budget marker", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-resume-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("lives in the journal without being read back as a record", () => {
    appendRecord(record({}), dir, "L");
    appendMixedLimitsMarker(
      { journalEvent: "mixed_limits", acceptedAt: "2026-09-23T00:00:00.000Z", differences: [{ fixtureId: "f", key: "maxSteps", recorded: 60, incoming: 30 }] },
      dir,
      "L"
    );
    appendRecord(record({ rep: 2 }), dir, "L");

    expect(readJournal(dir, "L").map(r => r.rep)).toEqual([1, 2]);
    expect(readJournalMarkers(dir, "L")).toHaveLength(1);
  });

  it("makes the rendered result say it is mixed, and says nothing when it is not", () => {
    const run = {
      label: "L",
      startedAt: "2026-09-20T00:00:00.000Z",
      finishedAt: "2026-09-20T01:00:00.000Z",
      model: { id: "m", provider: "p" },
      gitCommit: "abc1234",
      reps: 1,
      concurrency: 1,
      records: [record({})]
    };
    expect(renderMarkdown(run)).not.toContain("Mixed budget");

    const mixed = renderMarkdown({
      ...run,
      mixedLimits: [
        { journalEvent: "mixed_limits", acceptedAt: "2026-09-23T00:00:00.000Z", differences: [{ fixtureId: "f", key: "maxSteps", recorded: 60, incoming: 30 }] }
      ]
    });
    expect(mixed).toContain("Mixed budget");
    expect(mixed).toContain("maxSteps: journal 60, this run 30 (f)");
  });
});

describe("--reps bounds what a run reports", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-reps-cli-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("renders only repetitions 1..N, so a run stopped after rep 1 is reported as rep 1", () => {
    // B0 was abandoned after rep 1 with reps 2 and 3 partly measured. Its report must not mix them in.
    appendRecord(record({ rep: 1 }), dir, "R");
    appendRecord(record({ rep: 2, grader: { correct: false, reason: "", regressions: [], stillFailing: ["t"] } }), dir, "R");
    const cli = path.resolve(__dirname, "../src/cli.ts");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--conditions=development", cli, "--label", "R", "--reps", "1", "--report-only", "--out", dir],
      { cwd: path.resolve(__dirname, ".."), encoding: "utf8", timeout: 120_000 }
    );
    expect(result.status).toBe(0);
    const written = fs.readdirSync(dir).find(f => f.endsWith("-R.json"))!;
    const run = JSON.parse(fs.readFileSync(path.join(dir, written), "utf8"));
    expect(run.records.map((r: RunRecord) => r.rep)).toEqual([1]);
  }, 150_000);
});

describe("the CLI refuses a resume under a different budget", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-resume-cli-"));
    appendRecord(record({}), dir, "R");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("exits before measuring anything, prints the difference, and leaves the journal unmarked", () => {
    const cli = path.resolve(__dirname, "../src/cli.ts");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--conditions=development", cli, "--label", "R", "--reps", "1", "--fixture", "t1-ts-currency", "--out", dir],
      {
        cwd: path.resolve(__dirname, ".."),
        encoding: "utf8",
        // A stand-in key. The refusal happens before any request, so it is never sent.
        env: { ...process.env, NVIDIA_API_KEY: "stand-in-never-sent" },
        timeout: 120_000
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("modelRequestTimeoutMs: journal 600000");
    expect(result.stderr).toContain("Refusing to resume");
    expect(result.stdout).not.toMatch(/\[1\/\d+\] start/);
    expect(readJournalMarkers(dir, "R")).toEqual([]);
    expect(readJournal(dir, "R")).toHaveLength(1);
  }, 150_000);
});
