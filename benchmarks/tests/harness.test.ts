import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  materialise,
  unnecessaryChanges
} from "../src/fixture.js";
import { executeFixture } from "../src/execute.js";
import { gradeRubric, parseJUnit, resetBaselineCache } from "../src/graders.js";
import { SecretLeakError, assertNoSecret, assertNoSecretInArgv } from "../src/secrets.js";
import { classifyFailure, summarise } from "../src/metrics.js";
import { renderMarkdown } from "../src/report.js";
import { configureProvider, startRuntime, type TaskOutcome } from "../src/runner.js";
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

describe("Summarising", () => {
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
      failureClass: null,
      ...over
    }) as RunRecord;

  it("reports per-fixture success out of repetitions, because variance is the point", () => {
    const summary = summarise([
      record({ fixtureId: "a", rep: 1 }),
      record({ fixtureId: "a", rep: 2, grader: { correct: false, reason: "", regressions: [], stillFailing: [] }, failureClass: "planning_miss" }),
      record({ fixtureId: "b", rep: 1 })
    ]);
    expect(summary.perFixture).toEqual([
      { fixtureId: "a", tier: "T1", correct: 1, of: 2 },
      { fixtureId: "b", tier: "T1", correct: 1, of: 1 }
    ]);
    expect(summary.failureCounts).toEqual({ planning_miss: 1 });
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
      records: [record({})]
    });
    expect(markdown).toContain("# Benchmark run: test");
    expect(markdown).toContain("False completions");
  });
});

describe("The fixture set", () => {
  it("loads, and every fixture declares what it needs", () => {
    const fixtures = loadFixtures(fixturesRoot());
    expect(fixtures.length).toBeGreaterThan(0);
    for (const fixture of fixtures) {
      expect(fixture.spec.prompt.length, fixture.spec.id).toBeGreaterThan(10);
      expect(fixture.spec.allowedPaths.length, fixture.spec.id).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(fixture.dir, "repo")), fixture.spec.id).toBe(true);
    }
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
