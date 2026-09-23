import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntimeApp } from "../../apps/agent-runtime/src/server.js";
import {
  LeakageError,
  assertWithheldAbsent,
  assertWorkspaceIsPristine,
  fixturesRoot,
  loadFixtures,
  listFiles,
  materialise,
  unnecessaryChanges
} from "../src/fixture.js";
import { executeFixture } from "../src/execute.js";
import { gradeRubric, parseJUnit, resetBaselineCache } from "../src/graders.js";
import { SecretLeakError, assertNoSecret, assertNoSecretInArgv } from "../src/secrets.js";
import { agentAuthored, classifyFailure, refineFailureClass, summarise } from "../src/metrics.js";
import { acquireRunLock, killedByProvider, latestPerCell, renderMarkdown } from "../src/report.js";
import { configureProvider, createCounters, fold, startRuntime, type TaskOutcome } from "../src/runner.js";
import { SelfTestModel } from "../src/selftest_model.js";
import type { GraderVerdict, RunRecord } from "../src/types.js";

/**
 * Tests for the instrument.
 *
 * A benchmark that cannot be trusted is worse than none, because its numbers get quoted. These
 * prove the parts that would otherwise fail silently: that the grader notices an agent which did
 * nothing, that withheld tests cannot reach the workspace, and that a failure lands in the right
 * class.
 */

const FIXTURE_ID = "t1-ts-pagination";

describe("JUnit parsing", () => {
  it("reads the shape both ecosystems emit", () => {
    const xml = `<?xml version="1.0"?><testsuites>
      <testcase name="passes" classname="suite"/>
      <testcase name="fails" classname="suite"><failure message="nope">boom</failure></testcase>
      <testcase name="skipped one" classname="suite"><skipped/></testcase>
    </testsuites>`;
    const tests = parseJUnit(xml);
    expect(tests.get("suite.passes")).toBe("passed");
    expect(tests.get("suite.fails")).toBe("failed");
    expect(tests.get("suite.skipped one")).toBe("skipped");
  });

  it("treats an error the same as a failure", () => {
    const tests = parseJUnit(`<testcase name="boom" classname="s"><error message="x"/></testcase>`);
    expect(tests.get("s.boom")).toBe("failed");
  });

  it("returns nothing for an empty report rather than pretending everything passed", () => {
    expect(parseJUnit("<testsuites></testsuites>").size).toBe(0);
  });

  it("reads pytest's attribute order, where classname comes before name", () => {
    // Regression. Looking up "name" without a leading boundary matches the tail of classname, so
    // every pytest test came back identified as its module and no required test ever matched. Node
    // emits name first, so one ecosystem passed while the other silently graded everything wrong.
    const xml =
      '<testsuites><testsuite><testcase classname="billing.test_periods" name="test_a_week_counts_seven_days" time="0.001" /></testsuite></testsuites>';
    const tests = parseJUnit(xml);
    expect([...tests.keys()]).toEqual(["billing.test_periods.test_a_week_counts_seven_days"]);
  });

  it("reads both attribute orders identically", () => {
    const a = parseJUnit('<testcase classname="suite" name="case one" time="0"/>');
    const b = parseJUnit('<testcase name="case one" time="0" classname="suite"/>');
    expect([...a.keys()]).toEqual([...b.keys()]);
  });
});

describe("Keeping the credential out of what is written", () => {
  const env = { NVIDIA_API_KEY: "nvapi-REALKEYREALKEYREALKEY123" } as NodeJS.ProcessEnv;

  it("refuses a credential passed on the command line", () => {
    expect(() => assertNoSecretInArgv(["--label", "B0", "nvapi-REALKEYREALKEYREALKEY123"], env)).toThrow(SecretLeakError);
    expect(() => assertNoSecretInArgv(["--api-key", "anything"], env)).toThrow(SecretLeakError);
    expect(() => assertNoSecretInArgv(["--key=abc"], env)).toThrow(SecretLeakError);
  });

  it("accepts the arguments a real run uses", () => {
    expect(() => assertNoSecretInArgv(["--label", "B0", "--reps", "5", "--model", "nvidia/nemotron-3-ultra-550b-a55b"], env)).not.toThrow();
  });

  it("refuses to write anything containing the credential", () => {
    expect(() => assertNoSecret({ note: "auth nvapi-REALKEYREALKEYREALKEY123" }, "a result", env)).toThrow(SecretLeakError);
  });

  it("refuses anything merely shaped like a key, even from another environment", () => {
    expect(() => assertNoSecret("Authorization: sk-abcdefghijklmnopqrstuvwxyz", "a result", {})).toThrow(SecretLeakError);
  });

  it("names the location without printing the match", () => {
    try {
      assertNoSecret("x nvapi-REALKEYREALKEYREALKEY123", "the journal", env);
      throw new Error("expected a throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("the journal");
      expect(message).not.toContain("nvapi-REALKEY");
    }
  });

  it("does not mistake a task id for a key", () => {
    // Regression. "sk-" matches inside "task-1789916599421-4luq1c", so without a leading boundary
    // every single run refused to write its own result.
    expect(() => assertNoSecret({ taskId: "task-1789916599421-4luq1c" }, "a record", {})).not.toThrow();
    expect(() => assertNoSecret({ id: "evt-1789916599421-abcdefghijkl" }, "a record", {})).not.toThrow();
  });

  it("ignores an environment variable too short to be a credential", () => {
    expect(() => assertNoSecret("the value is x", "a record", { NVIDIA_API_KEY: "x" })).not.toThrow();
  });
});

describe("Scope", () => {
  it("counts a change outside the golden set as unnecessary", () => {
    const changed = ["src/pagination.ts", "README.md", "src/extra/helper.ts"];
    expect(unnecessaryChanges(changed, ["src/pagination.ts"])).toEqual(["README.md", "src/extra/helper.ts"]);
  });

  it("lets a directory prefix cover everything under it", () => {
    expect(unnecessaryChanges(["src/a.ts", "src/b/c.ts", "docs/x.md"], ["src/"])).toEqual(["docs/x.md"]);
  });

  it("still counts a deletion", () => {
    expect(unnecessaryChanges(["README.md (deleted)"], ["src/"])).toEqual(["README.md (deleted)"]);
  });
});

describe("What counts as a file in the workspace", () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-listfiles-"));
    const write = (rel: string) => {
      const target = path.join(dir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "x", "utf8");
    };
    write("src/index.ts");
    write("src/reports/exporter.ts");
    write("reports/junit.xml");
    write("node_modules/dep/index.js");
    write(".pytest_cache/v/cache/lastfailed");
    write("pkg/__pycache__/mod.pyc");
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("ignores tool artefacts wherever they appear", () => {
    const files = listFiles(dir);
    expect(files.some(f => f.includes("node_modules"))).toBe(false);
    expect(files.some(f => f.includes(".pytest_cache"))).toBe(false);
    expect(files.some(f => f.includes("__pycache__"))).toBe(false);
  });

  it("ignores the grader's report directory at the root only", () => {
    // "reports" is an ordinary name for a source directory. Skipping it at every depth made a real
    // src/reports/ invisible to the pristine check, to change detection and to the forbidden-string
    // scan, so a refactor could leave the old symbol there and be graded as complete.
    const files = listFiles(dir);
    expect(files).toContain("src/reports/exporter.ts");
    expect(files).not.toContain("reports/junit.xml");
  });
});

describe("Rubric grading", () => {
  const spec = {
    kind: "rubric" as const,
    passThreshold: 0.5,
    points: [
      { id: "entry", description: "names the entry point", anyOf: ["src/index\\.ts", "the entry point"] },
      { id: "db", description: "mentions the database layer", anyOf: ["postgres", "database layer"] }
    ]
  };

  it("scores a point on any one of its patterns and ignores wording", () => {
    const verdict = gradeRubric(spec, "The ENTRY POINT is wired up first, then Postgres.");
    expect(verdict.correct).toBe(true);
    expect(verdict.rubric?.scored.sort()).toEqual(["db", "entry"]);
  });

  it("fails below the threshold and names what was missed", () => {
    const verdict = gradeRubric(spec, "It is a web application.");
    expect(verdict.correct).toBe(false);
    expect(verdict.rubric?.missed.sort()).toEqual(["db", "entry"]);
    expect(verdict.reason).toContain("Missed");
  });
});

describe("Failure classification", () => {
  const outcome = (over: Partial<TaskOutcome> = {}): TaskOutcome => ({
    status: "failed",
    finalText: "",
    assistantText: "",
    terminalError: "",
    events: [],
    approvalsRequested: 0,
    clarificationsRequested: 0,
    toolCalls: 0,
    modelRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    peakPromptTokens: 0,
    planSteps: 0,
    planVersions: 0,
    repairAttempts: 0,
    repairRecovered: false,
    limitReached: false,
    providerFailures: { timeouts: 0, rateLimits: 0, gateway: 0, other: 0 },
    limits: {},
    ...over
  });
  const bad: GraderVerdict = { correct: false, reason: "", regressions: [], stillFailing: ["x"] };
  const good: GraderVerdict = { correct: true, reason: "", regressions: [], stillFailing: [] };

  it("assigns no class to work the grader accepts", () => {
    expect(classifyFailure({ outcome: outcome(), verdict: good, unnecessary: ["README.md"], peakContextRatio: 0.2 })).toBeNull();
  });

  it("recognises a provider saying the prompt did not fit", () => {
    const o = outcome({ finalText: "Provider Error: 400 - context_length_exceeded" });
    expect(classifyFailure({ outcome: o, verdict: bad, unnecessary: [], peakContextRatio: 0.4 })).toBe("context_overflow");
  });

  it("recognises overflow from the measured peak even when the provider says nothing useful", () => {
    expect(classifyFailure({ outcome: outcome(), verdict: bad, unnecessary: [], peakContextRatio: 1.02 })).toBe("context_overflow");
  });

  it("separates running out of budget from running out of ideas", () => {
    const o = outcome({ limitReached: true });
    expect(classifyFailure({ outcome: o, verdict: bad, unnecessary: [], peakContextRatio: 0.1 })).toBe("loop_truncation");
  });

  it("recognises a regression", () => {
    const verdict: GraderVerdict = { correct: false, reason: "", regressions: ["a.b"], stillFailing: [] };
    expect(classifyFailure({ outcome: outcome({ status: "completed" }), verdict, unnecessary: [], peakContextRatio: 0 })).toBe(
      "regression_introduced"
    );
  });

  it("calls a finished but wrong task a planning miss", () => {
    // Nothing broke, nothing overflowed, the agent believed it was done, and the work is wrong.
    expect(classifyFailure({ outcome: outcome({ status: "completed" }), verdict: bad, unnecessary: [], peakContextRatio: 0 })).toBe(
      "planning_miss"
    );
  });
});

/** A minimal record, so a test states only the fields it is about. */
const record = (over: Partial<RunRecord>): RunRecord =>
  ({
    fixtureId: "f",
    tier: "T1",
    ecosystem: "typescript",
    rep: 1,
    model: { id: "m", provider: "p" },
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
    promptTokens: 100,
    completionTokens: 10,
    peakPromptTokens: 50,
    contextWindow: 1000,
    peakContextRatio: 0.05,
    planSteps: 0,
    planVersions: 0,
    repairAttempts: 0,
    repairRecovered: false,
    providerFailures: { timeouts: 0, rateLimits: 0, gateway: 0, other: 0 },
    failureClass: null,
    ...over
  }) as RunRecord;

describe("Summarising", () => {

  it("reports per-fixture success out of repetitions, because variance is the point", () => {
    const summary = summarise([
      record({ fixtureId: "a", rep: 1 }),
      record({ fixtureId: "a", rep: 2, grader: { correct: false, reason: "", regressions: [], stillFailing: [] }, failureClass: "planning_miss" }),
      record({ fixtureId: "b", rep: 1 })
    ]);
    expect(summary.perFixture).toEqual([
      { fixtureId: "a", tier: "T1", correct: 1, of: 2, peakContextRatio: 0.05, providerFailures: { timeouts: 0, rateLimits: 0, gateway: 0, other: 0 }, falseFailures: 0, falseCompletions: 0 },
      { fixtureId: "b", tier: "T1", correct: 1, of: 1, peakContextRatio: 0.05, providerFailures: { timeouts: 0, rateLimits: 0, gateway: 0, other: 0 }, falseFailures: 0, falseCompletions: 0 }
    ]);
    expect(summary.failureCounts).toEqual({ planning_miss: 1 });
  });

  it("carries the peak prompt share per fixture, not only in aggregate", () => {
    // The aggregate maximum says one task got close to the window; it does not say which. Per
    // fixture is the number that predicts where the context ceiling bites.
    const summary = summarise([
      record({ fixtureId: "small", peakContextRatio: 0.04 }),
      record({ fixtureId: "big", peakContextRatio: 0.71 }),
      record({ fixtureId: "big", rep: 2, peakContextRatio: 0.55 })
    ]);
    expect(summary.perFixture.find(f => f.fixtureId === "big")?.peakContextRatio).toBe(0.71);
    expect(summary.perFixture.find(f => f.fixtureId === "small")?.peakContextRatio).toBe(0.04);
  });

  it("counts provider failures by cause, not as one number", () => {
    // Only some of these are COMU's. A timeout under concurrency is the measurement's own
    // contention arriving as a failed task; a gateway refusal tracks request size. Summing them
    // would hide which one moved.
    const summary = summarise([
      record({ providerFailures: { timeouts: 2, rateLimits: 0, gateway: 1, other: 0 } }),
      record({ rep: 2, providerFailures: { timeouts: 0, rateLimits: 3, gateway: 1, other: 1 } })
    ]);
    expect(summary.providerFailures).toEqual({ timeouts: 2, rateLimits: 3, gateway: 2, other: 1 });
    expect(summary.perFixture[0].providerFailures.timeouts).toBe(2);
  });

  it("counts a provider timeout, which arrives as its own event and never as a failure", () => {
    /*
     * The regression this exists for.
     *
     * The manager emits model_request.timed_out for a timeout and model_request.failed for
     * everything else, so folding only the failure event left the timeout count at zero however
     * many requests were abandoned. That is the one provider failure the benchmark can cause for
     * itself, and a metric that reads zero is worse than no metric: it says the instrument is
     * clean when it is not.
     */
    const counters = createCounters();
    fold(counters, { type: "model_request.timed_out", timeoutMs: 600_000 } as never);
    fold(counters, { type: "model_request.timed_out", timeoutMs: 600_000 } as never);
    fold(counters, { type: "model_request.failed", error: "503 Service Unavailable" } as never);
    expect(counters.providerFailures).toEqual({ timeouts: 2, rateLimits: 0, gateway: 1, other: 0 });
  });

  it("keeps COMU's own reason for ending, which the graded answer would otherwise replace", () => {
    // Without this a false failure records that COMU said "failed" and not what it said had gone
    // wrong, and the cause is the only part of a false failure anyone can act on.
    const counters = createCounters();
    fold(counters, {
      type: "task.failed",
      error: "The task stopped early: an execution limit was reached.",
      payload: { code: "LIMIT_REACHED" }
    } as never);
    expect(counters.status).toBe("failed");
    expect(counters.terminalError).toContain("LIMIT_REACHED");
    expect(counters.terminalError).toContain("execution limit");
  });

  it("treats a record written before the breakdown existed as zeros", () => {
    const legacy = record({});
    delete (legacy as Partial<RunRecord>).providerFailures;
    expect(() => summarise([legacy])).not.toThrow();
    expect(summarise([legacy]).providerFailures).toEqual({ timeouts: 0, rateLimits: 0, gateway: 0, other: 0 });
  });

  it("files a task the provider killed as a provider error, whatever the message says", () => {
    /*
     * The regression this exists for.
     *
     * classifyFailure decides "provider" by looking for that word in the error text. NVIDIA says
     * "NVIDIA API Error: 504 - ", so a task the gateway killed after the agent had edited six files
     * was filed as an unexplained grader failure. Three of the first four failures in B0 landed in
     * that class, which is where a class distribution stops being informative.
     */
    const killed = record({
      falseFailure: false,
      comuStatus: "failed",
      comuError: "NVIDIA API Error: 504 - ",
      failureClass: "grader_failed_other",
      providerFailures: { timeouts: 0, rateLimits: 0, gateway: 1, other: 0 },
      grader: { correct: false, reason: "The test suite could not be run.", regressions: [], stillFailing: [] }
    });
    expect(refineFailureClass(killed)).toBe("provider_error");
    expect(summarise([killed]).failureCounts).toEqual({ provider_error: 1 });
  });

  it("files an exhausted budget as truncation, not as an unexplained grader failure", () => {
    const starved = record({
      comuStatus: "failed",
      comuError: "REPAIR_TIMEOUT: Maximum repair time (180000ms) exceeded.",
      failureClass: "grader_failed_other",
      grader: { correct: false, reason: "Required tests still failing.", regressions: [], stillFailing: ["t"] }
    });
    expect(refineFailureClass(starved)).toBe("loop_truncation");
  });

  it("leaves a correct run unclassified and an ordinary failure alone", () => {
    expect(refineFailureClass(record({}))).toBeNull();
    const ordinary = record({
      comuStatus: "completed",
      failureClass: "planning_miss",
      grader: { correct: false, reason: "wrong", regressions: [], stillFailing: [] }
    });
    expect(refineFailureClass(ordinary)).toBe("planning_miss");
  });

  it("does not call compiled output an unnecessary change", () => {
    /*
     * The regression this exists for.
     *
     * A T7 onboarding question is answered, not edited. Two of them were recorded as making
     * thirty-three unnecessary changes each, every one a dist/*.js file emitted by a build. The
     * fixtures ship no dist/ at all.
     */
    expect(agentAuthored(["dist/src/main.js", "src/real.ts", "coverage/lcov.info"])).toEqual(["src/real.ts"]);

    const built = record({
      comuStatus: "failed",
      failureClass: "unnecessary_changes",
      unnecessaryChanges: ["dist/src/main.js", "dist/test/a.test.js"],
      grader: { correct: false, reason: "Scored 0 of 10 rubric points.", regressions: [], stillFailing: [] }
    });
    expect(refineFailureClass(built)).not.toBe("unnecessary_changes");
  });

  it("still counts a real change outside the golden set", () => {
    const real = record({
      comuStatus: "failed",
      failureClass: "unnecessary_changes",
      unnecessaryChanges: ["src/test-getuserorders.ts"],
      grader: { correct: false, reason: "The test suite exits 1.", regressions: [], stillFailing: [] }
    });
    expect(refineFailureClass(real)).toBe("unnecessary_changes");
  });

  it("counts the two directions of disagreement separately", () => {
    const summary = summarise([record({ falseCompletion: true }), record({ falseFailure: true }), record({})]);
    expect(summary.falseCompletions).toBe(1);
    expect(summary.falseFailures).toBe(1);
  });

  it("renders a report without a model in the loop", () => {
    const markdown = renderMarkdown({
      label: "test",
      startedAt: "2026-09-20T00:00:00.000Z",
      finishedAt: "2026-09-20T00:10:00.000Z",
      model: { id: "m", provider: "p" },
      gitCommit: "abc1234",
      reps: 1,
      concurrency: 1,
      records: [record({})]
    });
    expect(markdown).toContain("# Benchmark run: test");
    expect(markdown).toContain("False completions");
    // A sequential run says nothing about concurrency; only a parallel one needs the caveat.
    expect(markdown).not.toContain("upper bound");
  });

  it("warns that wall clock is an upper bound when runs were parallel", () => {
    const markdown = renderMarkdown({
      label: "parallel",
      startedAt: "2026-09-20T00:00:00.000Z",
      finishedAt: "2026-09-20T00:10:00.000Z",
      model: { id: "m", provider: "p" },
      gitCommit: "abc1234",
      reps: 1,
      concurrency: 4,
      records: [record({})]
    });
    expect(markdown).toContain("concurrency 4");
    expect(markdown).toContain("upper bound");
  });

  it("groups digits the same way wherever it is rendered", () => {
    // toLocaleString() with no locale follows the host: 174,779 came out as "1,74,779" on the
    // machine this was run on. A committed result is compared against later runs and read
    // elsewhere, so its numbers cannot change shape with the reader.
    const markdown = renderMarkdown({
      label: "digits",
      startedAt: "2026-09-20T00:00:00.000Z",
      finishedAt: "2026-09-20T00:10:00.000Z",
      model: { id: "m", provider: "p" },
      gitCommit: "abc1234",
      reps: 1,
      concurrency: 1,
      records: [record({ promptTokens: 174779 })]
    });
    expect(markdown).toContain("174,779");
    expect(markdown).not.toContain("1,74,779");
  });

  it("names the cause of each false failure, not just the count", () => {
    // A count says the agent disagreed with the workspace. It does not say whether that was a
    // budget set too low, a provider timeout the concurrency caused, or a gate misfiring on work
    // already done, and only one of those is COMU's.
    const markdown = renderMarkdown({
      label: "causes",
      startedAt: "2026-09-20T00:00:00.000Z",
      finishedAt: "2026-09-20T00:10:00.000Z",
      model: { id: "m", provider: "p" },
      gitCommit: "abc1234",
      reps: 1,
      concurrency: 4,
      records: [
        record({
          fixtureId: "t3-py-rename",
          falseFailure: true,
          comuStatus: "failed",
          comuError: "LIMIT_REACHED: The task stopped early: an execution limit was reached.",
          providerFailures: { timeouts: 1, rateLimits: 0, gateway: 0, other: 0 }
        })
      ]
    });
    expect(markdown).toContain("False failures, with causes");
    expect(markdown).toContain("LIMIT_REACHED");
    expect(markdown).toContain("1/0/0/0");
  });
});

describe("Re-measuring a cell the provider killed", () => {
  const killed = (over: Partial<RunRecord> = {}): RunRecord =>
    record({
      comuStatus: "failed",
      providerFailures: { timeouts: 1, rateLimits: 0, gateway: 0, other: 0 },
      ...over
    });

  it("treats a provider-ended run as not a measurement of COMU", () => {
    // A timeout under concurrency ends the task with the agent's work half applied, and the grader
    // then reports a failure the agent did not commit.
    expect(killedByProvider(killed())).toBe(true);
    expect(killedByProvider(record({}))).toBe(false);
  });

  it("does not re-measure a run that succeeded despite a retried provider failure", () => {
    // One 504 that was retried and recovered is not a reason to pay for the run again.
    expect(killedByProvider(killed({ comuStatus: "completed" }))).toBe(false);
  });

  it("keeps the later measurement of a cell and leaves the earlier one in the journal", () => {
    const first = killed({ fixtureId: "t4-ts-async", rep: 1, durationMs: 864_000 });
    const second = record({ fixtureId: "t4-ts-async", rep: 1, durationMs: 120_000 });
    const deduped = latestPerCell([first, second]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].durationMs).toBe(120_000);
  });

  it("counts a re-measured cell once", () => {
    const summary = summarise(
      latestPerCell([
        killed({ fixtureId: "f", rep: 1 }),
        record({ fixtureId: "f", rep: 1 }),
        record({ fixtureId: "f", rep: 2 })
      ])
    );
    expect(summary.runs).toBe(2);
    expect(summary.perFixture[0].of).toBe(2);
  });
});

describe("The run lock", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-lock-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a second runner under the same label", () => {
    /*
     * The regression this exists for.
     *
     * Three runners were once alive at once against one journal. They tripled the provider load,
     * duplicated work, and would each have written the result file from their own partial records.
     * Nothing in the output showed it; the runs were merely slow.
     */
    const release = acquireRunLock(dir, "B0");
    expect(() => acquireRunLock(dir, "B0")).toThrow(/already going/);
    release();
    expect(() => acquireRunLock(dir, "B0")()).not.toThrow();
  });

  it("takes over a lock whose holder is gone", () => {
    // A killed run must not leave a lock that needs deleting by hand, or the next person deletes
    // it reflexively and the guard stops meaning anything.
    fs.writeFileSync(path.join(dir, "B0.lock"), "999999999", "utf8");
    expect(() => acquireRunLock(dir, "B0")()).not.toThrow();
  });

  it("does not block a different label", () => {
    const release = acquireRunLock(dir, "B0");
    expect(() => acquireRunLock(dir, "B1")()).not.toThrow();
    release();
  });
});

describe("The fixture set", () => {
  it("loads, and every fixture declares what it needs", () => {
    const fixtures = loadFixtures(fixturesRoot());
    expect(fixtures.length).toBeGreaterThan(0);
    for (const fixture of fixtures) {
      expect(fixture.spec.prompt.length, fixture.spec.id).toBeGreaterThan(10);
      expect(Array.isArray(fixture.spec.allowedPaths), fixture.spec.id).toBe(true);
      // A rubric fixture asks a question and expects no edit, so an empty allow list is correct
      // there and means "anything you change is an unnecessary change".
      if (fixture.spec.grader.kind !== "rubric") {
        expect(fixture.spec.allowedPaths.length, fixture.spec.id).toBeGreaterThan(0);
      }
      expect(fs.existsSync(path.join(fixture.dir, "repo")), fixture.spec.id).toBe(true);
    }
  });

  it("covers every tier three times, across both ecosystems", () => {
    // The suite's shape is part of the measurement. A tier with one fixture cannot distinguish a
    // real change from that fixture's quirks, and a single ecosystem would hide exactly the
    // multi-language gaps Phase 2 is meant to close.
    const fixtures = loadFixtures(fixturesRoot());
    const byTier = new Map<string, string[]>();
    for (const f of fixtures) {
      byTier.set(f.spec.tier, [...(byTier.get(f.spec.tier) ?? []), f.spec.id]);
    }
    for (const tier of ["T1", "T2", "T3", "T4", "T7"]) {
      expect(byTier.get(tier)?.length ?? 0, `${tier}: ${JSON.stringify(byTier.get(tier) ?? [])}`).toBeGreaterThanOrEqual(3);
    }
    const ecosystems = new Set(fixtures.map(f => f.spec.ecosystem));
    expect([...ecosystems].sort()).toEqual(["python", "typescript"]);
    // Every tier must have at least one Python fixture, or "verified ecosystems" is a claim about
    // TypeScript with a Python footnote.
    for (const [tier, ids] of byTier) {
      const hasPython = fixtures.some(f => f.spec.tier === tier && f.spec.ecosystem === "python");
      expect(hasPython, `${tier} has no Python fixture: ${ids.join(", ")}`).toBe(true);
    }
  });

  it("keeps a Python fixture whose root package.json triggers the misclassification", () => {
    // Deliberately not designed around. ProjectDetector checks package.json before pyproject.toml,
    // so this repository is treated as Node and its verification cannot run. Removing it would
    // hide the defect rather than measure it.
    const fixtures = loadFixtures(fixturesRoot());
    const trap = fixtures.filter(
      f => f.spec.ecosystem === "python" && fs.existsSync(path.join(f.dir, "repo", "package.json"))
    );
    expect(trap.length, "no Python fixture carries a root package.json").toBeGreaterThanOrEqual(1);
  });

  it("never puts the answer or the grader's tests in the starting workspace", () => {
    for (const fixture of loadFixtures(fixturesRoot())) {
      const workspace = materialise(fixture);
      try {
        // materialise already asserts this; calling again states the invariant in the test itself.
        expect(() => assertWorkspaceIsPristine(fixture, workspace.root)).not.toThrow();
        expect(() => assertWithheldAbsent(fixture, workspace.root, "in the test")).not.toThrow();
      } finally {
        workspace.dispose();
      }
    }
  });

  it("notices when something strays into the workspace", () => {
    const fixture = loadFixtures(fixturesRoot(), { ids: [FIXTURE_ID] })[0];
    const workspace = materialise(fixture);
    try {
      fs.writeFileSync(path.join(workspace.root, "leaked.txt"), "the answer", "utf8");
      expect(() => assertWorkspaceIsPristine(fixture, workspace.root)).toThrow(LeakageError);
    } finally {
      workspace.dispose();
    }
  });

  it("notices a grader-only test appearing in the workspace", () => {
    const fixture = loadFixtures(fixturesRoot(), { ids: [FIXTURE_ID] })[0];
    const workspace = materialise(fixture);
    try {
      const target = path.join(workspace.root, "tests", "pagination.withheld.test.ts");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "// whatever", "utf8");
      expect(() => assertWithheldAbsent(fixture, workspace.root, "in the test")).toThrow(LeakageError);
    } finally {
      workspace.dispose();
    }
  });
});

/**
 * End to end, with a stand-in model.
 *
 * The two outcomes that matter are proved against the same fixture: a model that applies the fix is
 * graded correct, and a model that announces success without touching anything is graded incorrect
 * and recorded as a false completion.
 */
describe("End to end against a stand-in model", () => {
  let runtime: Awaited<ReturnType<typeof startRuntime>>;

  const start = async (behaviour: "apply" | "claim-without-doing") => {
    const fixture = loadFixtures(fixturesRoot(), { ids: [FIXTURE_ID] })[0];
    runtime = await startRuntime(createRuntimeApp as never, {
      providerFactory: () => new SelfTestModel(path.join(fixture.dir, "golden"), behaviour)
    });
    await configureProvider(runtime.baseUrl, runtime.headers, { "selftest-model": { apiKey: "selftest" } });
    return executeFixture({
      fixture,
      rep: 1,
      baseUrl: runtime.baseUrl,
      headers: runtime.headers,
      model: { id: "selftest-model", provider: "selftest" },
      concurrency: 1,
      contextWindow: 128_000,
      timeoutMs: 180_000
    });
  };

  beforeAll(() => resetBaselineCache());
  afterAll(async () => runtime?.stop());

  it("grades a real fix as correct, including the tests the agent never saw", async () => {
    const record = await start("apply");
    await runtime.stop();
    expect(record.harnessError).toBeUndefined();
    expect(record.grader.correct, record.grader.reason).toBe(true);
    expect(record.grader.stillFailing).toEqual([]);
    expect(record.falseCompletion).toBe(false);
    expect(record.filesChanged).toContain("src/pagination.ts");
    expect(record.unnecessaryChanges).toEqual([]);
  }, 240_000);

  it("grades an agent that changed nothing as incorrect, whatever it said", async () => {
    const record = await start("claim-without-doing");
    await runtime.stop();
    expect(record.grader.correct).toBe(false);
    expect(record.grader.stillFailing.length).toBeGreaterThan(0);
    expect(record.filesChanged).toEqual([]);
    // COMU's completion gate does catch this one: verification fails, repair runs out, and the
    // run stops at a limit. Recorded rather than asserted as a false completion, because a false
    // completion is what happens when the gate does NOT catch it.
    expect(record.comuStatus).not.toBe("completed");
    expect(record.falseCompletion).toBe(false);
  }, 240_000);

  it("receives a terminal event even when the run stops at a limit", async () => {
    // The runtime used to publish agent.limit_reached and then nothing, so every client waiting
    // for a task.* event waited forever. The harness deliberately does not compensate: if this
    // regresses, the status is "unknown" and this test says so.
    const record = await start("claim-without-doing");
    await runtime.stop();
    expect(record.comuStatus).toBe("failed");
    expect(record.failureClass).toBe("loop_truncation");
  }, 240_000);
});

describe("Temporary workspaces", () => {
  it("are cleaned up", () => {
    const fixture = loadFixtures(fixturesRoot(), { ids: [FIXTURE_ID] })[0];
    const workspace = materialise(fixture);
    const root = workspace.root;
    expect(fs.existsSync(root)).toBe(true);
    workspace.dispose();
    expect(fs.existsSync(root)).toBe(false);
    expect(root.startsWith(os.tmpdir())).toBe(true);
  });
});
