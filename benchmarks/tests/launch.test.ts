import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gatewayBaseline, judgeGateway, probeMedian } from "../src/gateway.js";
import { summarise } from "../src/metrics.js";
import {
  acquireRunLock,
  appendMarker,
  appendRecord,
  readJournal,
  readJournalEvents,
  readRunLock,
  renderMarkdown,
  updateRunLock
} from "../src/report.js";
import { createCounters, fold } from "../src/runner.js";
import { describeStatus } from "../src/status.js";
import type { GatewayBaseline, GatewayCheck, RunRecord } from "../src/types.js";

/**
 * Launching a measurement, and knowing what it was launched into.
 *
 * B1 died at 2 of 15 cells with the shell that started it, and it had been launched into a gateway
 * four to seven times slower than B0's because the watcher accepted any 200. These cover what now
 * stands in the way of both: latency recorded per cell, a launch gate on latency, and a status that
 * reads a detached run from disk.
 */

const record = (over: Partial<RunRecord>): RunRecord =>
  ({
    fixtureId: "f",
    tier: "T1",
    ecosystem: "typescript",
    rep: 1,
    model: { id: "m", provider: "p" },
    limits: {},
    startedAt: "2026-09-24T00:00:00.000Z",
    durationMs: 1000,
    concurrency: 1,
    comuStatus: "completed",
    comuError: "",
    finalAnswer: "",
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
    providerFailures: { timeouts: 0, rateLimits: 0, gateway: 0, other: 0 },
    planSteps: 0,
    planVersions: 0,
    repairAttempts: 0,
    repairRecovered: false,
    failureClass: null,
    ...over
  }) as RunRecord;

describe("request latency per cell", () => {
  it("counts every settled request, the slow failures included", () => {
    // A request that hangs for minutes and then fails is the latency the run was measured under as
    // much as one that answers. B1's t1-py-interval spent 515 s on one request that ended in
    // "fetch failed".
    const c = createCounters();
    const at = (s: number) => new Date(Date.UTC(2026, 8, 24, 0, 0, s)).toISOString();
    fold(c, { type: "model_request.started", requestId: "r1", attempt: 1, timestamp: at(0) } as never);
    fold(c, { type: "model_request.succeeded", requestId: "r1", attempt: 1, timestamp: at(9), latencyMs: 8_500 } as never);
    fold(c, { type: "model_request.started", requestId: "r2", attempt: 1, timestamp: at(10) } as never);
    fold(c, { type: "model_request.failed", requestId: "r2", attempt: 1, timestamp: at(40), error: "fetch failed" } as never);
    fold(c, { type: "model_request.started", requestId: "r2", attempt: 2, timestamp: at(41) } as never);
    fold(c, { type: "model_request.timed_out", requestId: "r2", attempt: 2, timestamp: at(59), timeoutMs: 18_000 } as never);
    // The runtime's own latencyMs where it gives one; the timestamps otherwise.
    expect(c.requestLatenciesMs).toEqual([8_500, 30_000, 18_000]);
  });

  it("shows per cell beside the result, and as a spread across cells", () => {
    const fast = record({ fixtureId: "a", durationMs: 120_000, modelRequests: 4, requestLatency: { medianMs: 20_000, minMs: 5_000, maxMs: 40_000, count: 4 } });
    const slow = record({ fixtureId: "b", durationMs: 600_000, modelRequests: 2, requestLatency: { medianMs: 250_000, minMs: 200_000, maxMs: 300_000, count: 2 } });
    const legacy = record({ fixtureId: "c", durationMs: 710_000, modelRequests: 10 });

    const summary = summarise([fast, slow, legacy]);
    expect(summary.perFixture.map(f => [f.fixtureId, f.requestLatencyMs, f.wallClockPerRequestMs])).toEqual([
      ["a", 20_000, 30_000],
      ["b", 250_000, 300_000],
      // Written before latency was recorded: no latency, but its wall clock per request still compares.
      ["c", null, 71_000]
    ]);
    expect(summary.requestLatencyMs).toEqual({ median: 135_000, min: 20_000, max: 250_000 });

    const markdown = renderMarkdown({
      label: "latency",
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: "2026-09-24T01:00:00.000Z",
      model: { id: "m", provider: "p" },
      gitCommit: "abc1234",
      reps: 1,
      concurrency: 1,
      records: [fast, slow, legacy]
    });
    expect(markdown).toContain("| Request latency, median | Wall clock per request |");
    expect(markdown).toMatch(/\| b \|[^\n]*\| 250\.0s \| 300\.0s \|/);
    expect(markdown).toMatch(/\| c \|[^\n]*\| - \| 71\.0s \|/);
    expect(markdown).toContain("| Model request latency, per-cell median (range across cells) | 135.0s (20.0s to 250.0s) |");
  });

  it("counts a killed cell's latency, since it describes the provider the run met", () => {
    const killed = record({ comuStatus: "failed", providerFailures: { timeouts: 0, rateLimits: 0, gateway: 1, other: 0 }, requestLatency: { medianMs: 515_000, minMs: 515_000, maxMs: 515_000, count: 1 } });
    const summary = summarise([killed]);
    expect(summary.runs).toBe(0);
    expect(summary.requestLatencyMs?.median).toBe(515_000);
  });
});

describe("the launch gate", () => {
  const baseline: GatewayBaseline = { label: "B0", source: "2026-09-20-B0.json", measure: "wall_clock_per_request", medianMs: 71_000, cells: 15 };

  it("takes the median of three probes, a failed probe counting as slower than any answer", () => {
    expect(probeMedian([{ at: "", latencyMs: 3_000 }, { at: "", latencyMs: 90_000 }, { at: "", latencyMs: 1_000 }])).toBe(3_000);
    expect(probeMedian([{ at: "", latencyMs: 3_000 }, { at: "", latencyMs: null, error: "504" }, { at: "", latencyMs: 1_000 }])).toBe(3_000);
    expect(probeMedian([{ at: "", latencyMs: 3_000 }, { at: "", latencyMs: null }, { at: "", latencyMs: null }])).toBeNull();
  });

  it("refuses past the multiple of the baseline's median, and not before", () => {
    const at = (ms: number | null) => ({ at: "", latencyMs: ms });
    const ok = judgeGateway([at(140_000), at(141_000), at(143_000)], baseline, 2);
    expect(ok.thresholdMs).toBe(142_000);
    expect(ok.slow).toBe(false);
    expect(judgeGateway([at(140_000), at(143_000), at(150_000)], baseline, 2).slow).toBe(true);
    expect(judgeGateway([at(1_000), at(null), at(null)], baseline, 2).slow).toBe(true);
    expect(judgeGateway([at(150_000), at(150_000), at(150_000)], baseline, 3).slow).toBe(false);
  });

  it("reads the frozen B0 result as a 71 s baseline, from wall clock per request", () => {
    // B0 predates per-request latency, so the gate falls back to the measure B0's 71 s was computed
    // with, over exactly the 15 frozen rep 1 cells rather than the journal's abandoned repetitions.
    const b0 = gatewayBaseline(path.resolve(__dirname, "../results"), "B0");
    expect(b0?.measure).toBe("wall_clock_per_request");
    expect(b0?.cells).toBe(15);
    expect(Math.round((b0?.medianMs ?? 0) / 1000)).toBe(71);
  });
});

describe("journal markers and the run lock", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-launch-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const check: GatewayCheck = {
    probes: [{ at: "2026-09-24T00:00:00.000Z", latencyMs: 300_000 }],
    medianMs: 300_000,
    thresholdMs: 142_000,
    multiple: 2,
    baseline: { label: "B0", source: "2026-09-20-B0.json", measure: "wall_clock_per_request", medianMs: 71_000, cells: 15 },
    slow: true
  };

  it("keeps gateway markers out of the records and states an accepted slow gateway in the result", () => {
    appendMarker({ journalEvent: "gateway_probe", probedAt: "2026-09-24T00:00:00.000Z", check }, dir, "B1");
    appendMarker({ journalEvent: "slow_gateway", acceptedAt: "2026-09-24T00:00:01.000Z", check }, dir, "B1");
    appendRecord(record({}), dir, "B1");

    expect(readJournal(dir, "B1")).toHaveLength(1);
    expect(readJournalEvents(dir, "B1", "gateway_probe")).toHaveLength(1);
    expect(readJournalEvents(dir, "B1", "slow_gateway")).toHaveLength(1);
    expect(readJournalEvents(dir, "B1", "mixed_limits")).toHaveLength(0);

    const markdown = renderMarkdown({
      label: "B1",
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: "2026-09-24T01:00:00.000Z",
      model: { id: "m", provider: "p" },
      gitCommit: "abc1234",
      reps: 1,
      concurrency: 1,
      records: readJournal(dir, "B1"),
      gatewayProbes: readJournalEvents(dir, "B1", "gateway_probe"),
      slowGateway: readJournalEvents(dir, "B1", "slow_gateway")
    });
    expect(markdown).toContain("**Slow gateway.**");
    expect(markdown).toContain("Threshold 142.0s: 2x B0's median wall clock per successful request of 71.0s");
    expect(markdown).toContain("**Provider at launch.**");
  });

  it("reads a lock written as a bare pid, from before the lock carried state", () => {
    fs.writeFileSync(path.join(dir, "B1.lock"), "32940", "utf8");
    expect(readRunLock(dir, "B1")?.pid).toBe(32940);
  });

  it("reports a live run's progress from its lock and journal", () => {
    const release = acquireRunLock(dir, "B1");
    updateRunLock(dir, "B1", s => {
      s.planned = ["a#1", "b#1", "c#1"];
      s.finished = ["a#1"];
      s.inFlight = [{ cell: "b#1", startedAt: "2026-09-24T00:05:00.000Z" }];
    });
    appendRecord(record({ fixtureId: "a", startedAt: "2026-09-24T00:00:00.000Z", durationMs: 240_000 }), dir, "B1");
    fs.writeFileSync(path.join(dir, "B1.console.log"), "log", "utf8");

    const lines = describeStatus({ outDir: dir, label: "B1", scope: ["a#1", "b#1", "c#1"], now: new Date("2026-09-24T00:10:00.000Z") });
    expect(lines[0]).toContain(`running, pid ${process.pid} is alive`);
    expect(lines).toContain("This launch: 1 of 3 cells finished, 1 in flight, 1 not started.");
    expect(lines).toContain("  in flight: b#1, started 5m ago");
    expect(lines).toContain("Journal: 1 of 3 cells in scope recorded, 1 measured; 2 without a record.");
    expect(lines).toContain("Last record: a rep 1, finished 6m ago.");
    release();
    expect(fs.existsSync(path.join(dir, "B1.lock"))).toBe(false);
  });

  it("says so when the lock's holder is dead", () => {
    fs.writeFileSync(path.join(dir, "B1.lock"), "999999999", "utf8");
    appendRecord(record({ comuStatus: "failed", providerFailures: { timeouts: 0, rateLimits: 0, gateway: 1, other: 0 } }), dir, "B1");
    const lines = describeStatus({ outDir: dir, label: "B1", scope: ["f#1", "g#1"] });
    expect(lines[0]).toContain("NOT RUNNING");
    expect(lines).toContain(
      "Journal: 1 of 2 cells in scope recorded, 0 measured, 1 ended by the provider (measured again only under --redo-provider-failures); 1 without a record."
    );
  });
});
