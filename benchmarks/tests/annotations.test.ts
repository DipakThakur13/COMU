import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { annotate, readAnnotations, renderMarkdown } from "../src/report.js";
import type { BenchmarkRun, RunAnnotations, RunRecord } from "../src/types.js";

/**
 * What became known about a run after its records were written.
 *
 * B0 was launched naming Ultra 550B and served entirely by Lightning 30B-A3B. The journal keeps what
 * the harness believed; the report must name what actually ran, every time it is rendered.
 */

const ULTRA = { id: "nvidia/nemotron-3-ultra-550b-a55b", provider: "nvidia" };

const record = (over: Partial<RunRecord>): RunRecord =>
  ({
    fixtureId: "f",
    tier: "T1",
    ecosystem: "typescript",
    rep: 1,
    model: ULTRA,
    limits: {},
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

const run = (records: RunRecord[]): BenchmarkRun => ({
  label: "B0",
  startedAt: "2026-09-20T00:00:00.000Z",
  finishedAt: "2026-09-20T01:00:00.000Z",
  model: ULTRA,
  gitCommit: "abc1234",
  reps: 1,
  concurrency: 1,
  records
});

const correction: RunAnnotations = {
  servedModel: {
    id: "nvidia/nemotron-3.5-lightning-30b-a3b",
    provider: "nvidia",
    launchedAs: ULTRA.id,
    reason: "The modelId never reached the provider."
  },
  limitations: ["The typecheck signal carries no information for T1-T4."]
};

describe("annotations", () => {
  it("name the served model everywhere the result names a model, and say what it was launched as", () => {
    const annotated = annotate(run([record({}), record({ rep: 2 })]), correction);
    const json = JSON.stringify(annotated);

    expect(annotated.model.id).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(annotated.records.every(r => r.model.id === "nvidia/nemotron-3.5-lightning-30b-a3b")).toBe(true);
    // The launched name survives only as the stated correction, never as a model the result claims.
    expect(annotated.annotations?.servedModel?.launchedAs).toBe(ULTRA.id);
    expect(json.split(ULTRA.id).length - 1).toBe(1);

    const markdown = renderMarkdown(annotated);
    expect(markdown).toContain("Model `nvidia/nemotron-3.5-lightning-30b-a3b`");
    expect(markdown).toContain(`launched naming \`${ULTRA.id}\``);
    expect(markdown).toContain("The typecheck signal carries no information for T1-T4.");
  });

  it("leave a run without annotations exactly as it was", () => {
    const plain = run([record({})]);
    expect(annotate(plain, undefined)).toBe(plain);
    expect(renderMarkdown(plain)).not.toContain("Model correction");
  });

  describe("on disk", () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-annotations-"));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("are read from beside the journal, and absent when there is no file", () => {
      expect(readAnnotations(dir, "B0")).toBeUndefined();
      fs.writeFileSync(path.join(dir, "B0.annotations.json"), JSON.stringify(correction));
      expect(readAnnotations(dir, "B0")).toEqual(correction);
    });
  });

  it("the committed B0 annotation parses and corrects the model", () => {
    const committed = readAnnotations(path.resolve(__dirname, "../results"), "B0");
    expect(committed?.servedModel?.id).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(committed?.servedModel?.launchedAs).toBe(ULTRA.id);
  });
});

describe("the per-fixture table", () => {
  it("counts false failures and false completions per fixture", () => {
    const markdown = renderMarkdown(
      run([
        record({ fixtureId: "a", rep: 1, falseFailure: true, comuStatus: "failed" }),
        record({ fixtureId: "a", rep: 2, falseFailure: true, comuStatus: "failed" }),
        record({ fixtureId: "b", rep: 1, falseCompletion: true, grader: { correct: false, reason: "", regressions: [], stillFailing: ["t"] } })
      ])
    );
    expect(markdown).toContain("| Fixture | Tier | Correct | False failures | False completions |");
    expect(markdown).toMatch(/\| a \| T1 [^|]*\| 2 of 2 \| 2 \| 0 \|/);
    expect(markdown).toMatch(/\| b \| T1 [^|]*\| 0 of 1 \| 0 \| 1 \|/);
  });

  it("counts completions COMU itself marked NOT_VERIFIED, beside and not instead of false completions", () => {
    const wrong = { correct: false, reason: "", regressions: [], stillFailing: ["t"] };
    const markdown = renderMarkdown(
      run([
        // Unverified and wrong: still a false completion, and also an unverified one.
        record({ fixtureId: "c", rep: 1, verificationStatus: "NOT_VERIFIED", falseCompletion: true, grader: wrong }),
        // Unverified and right.
        record({ fixtureId: "c", rep: 2, verificationStatus: "NOT_VERIFIED" }),
        // Verified: not counted.
        record({ fixtureId: "c", rep: 3, verificationStatus: "PASSED" }),
        // Failed with nothing verified: not a completion, so not counted.
        record({ fixtureId: "c", rep: 4, verificationStatus: "NOT_VERIFIED", comuStatus: "failed" })
      ])
    );
    expect(markdown).toContain("| Unverified completions |");
    expect(markdown).toMatch(/\| c \| T1 [^|]*\| 3 of 4 \| 0 \| 1 \| 2 \|/);
    expect(markdown).toContain("| Unverified completions (COMU said NOT_VERIFIED) | 2 |");
  });
});
