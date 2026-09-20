import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fixturesRoot, loadFixtures, materialise, type LoadedFixture, type Workspace } from "../src/fixture.js";
import { grade, parseJUnit, resetBaselineCache, setupWorkspace } from "../src/graders.js";
import type { FixtureSpec, GraderVerdict } from "../src/types.js";

/**
 * Grading the grader.
 *
 * The grader decides every number this benchmark reports and nothing else checks it. A grader that
 * is wrong in one direction manufactures improvements; wrong in the other it hides them. So each
 * case below is a deliberately wrong workspace with a verdict worked out by hand, and the test
 * asserts the grader reaches that verdict for that reason.
 *
 * The cases are chosen to be the ones a plausible agent actually produces: the fix that satisfies
 * the example it was shown, the fix that breaks something else, the change that was only half
 * applied, and the edit that stops the suite running at all.
 */

const TS = "t1-ts-pagination";
const PY = "t1-py-interval";

function fixture(id: string): LoadedFixture {
  const found = loadFixtures(fixturesRoot(), { ids: [id] })[0];
  if (!found) throw new Error(`fixture ${id} not found`);
  return found;
}

function write(workspace: Workspace, rel: string, content: string): void {
  const target = path.join(workspace.root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function golden(f: LoadedFixture, rel: string): string {
  return fs.readFileSync(path.join(f.dir, "golden", rel), "utf8");
}

/**
 * Applies a substitution and refuses to continue if it matched nothing.
 *
 * A replacement that silently does nothing leaves the previous case's file in place, and the next
 * assertion then grades the wrong thing. That happened here: fixture sources are checked out with
 * CRLF endings, so a pattern containing a newline matched nothing and the "wrong fix" case was
 * quietly grading the correct fix and reporting a pass.
 */
function mutate(source: string, find: string, replaceWith: string): string {
  if (!source.includes(find)) {
    throw new Error(`mutation target not found: ${JSON.stringify(find)}`);
  }
  return source.replace(find, replaceWith);
}

beforeAll(() => resetBaselineCache());

// ── TypeScript ───────────────────────────────────────────────────────────────

describe("TypeScript fixture", () => {
  const f = fixture(TS);
  let ws: Workspace;

  const regrade = async (): Promise<GraderVerdict> => grade(f, ws, "");

  beforeAll(async () => {
    ws = materialise(f);
    await setupWorkspace(f, ws);
  });
  afterAll(() => ws?.dispose());

  it("accepts the correct fix", async () => {
    write(ws, "src/pagination.ts", golden(f, "src/pagination.ts"));
    const verdict = await regrade();
    expect(verdict.correct, verdict.reason).toBe(true);
    expect(verdict.regressions).toEqual([]);
    expect(verdict.stillFailing).toEqual([]);
  }, 120_000);

  it("rejects an empty diff, and says which tests are still failing", async () => {
    write(ws, "src/pagination.ts", fs.readFileSync(path.join(f.dir, "repo/src/pagination.ts"), "utf8"));
    const verdict = await regrade();
    expect(verdict.correct).toBe(false);
    expect(verdict.stillFailing.length).toBeGreaterThan(0);
    expect(verdict.regressions).toEqual([]);
    expect(verdict.reason).toMatch(/still failing/i);
  }, 120_000);

  it("rejects a fix that satisfies the visible test and nothing else", async () => {
    // The failure mode that matters most. Special-casing page zero passes the one example the
    // agent was shown and is wrong for every later page. Only the withheld tests catch it, which
    // is why they are withheld.
    write(
      ws,
      "src/pagination.ts",
      mutate(
        golden(f, "src/pagination.ts"),
        "const end = start + size;",
        "const end = page === 0 ? start + size : start + size - 1;"
      )
    );
    const verdict = await regrade();
    expect(verdict.correct).toBe(false);
    expect(verdict.stillFailing.some(t => t.includes("second page"))).toBe(true);
  }, 120_000);

  it("reports a regression separately from a test that never passed", async () => {
    // pageSlice fixed, paginate broken. The required tests pass; a test that was green goes red.
    write(
      ws,
      "src/pagination.ts",
      mutate(golden(f, "src/pagination.ts"), "Math.ceil(items.length / size)", "Math.floor(items.length / size)")
    );
    const verdict = await regrade();
    expect(verdict.correct).toBe(false);
    expect(verdict.regressions.some(t => t.includes("totalPages"))).toBe(true);
    expect(verdict.reason).toMatch(/previously passing/i);
  }, 120_000);

  it("distinguishes a suite that could not run from a suite that failed", async () => {
    // An agent that leaves the file unparseable has not produced failing tests; it has produced no
    // tests. Recording that as "everything failed" would put it in the wrong failure class.
    write(ws, "src/pagination.ts", "export function pageSlice( {{{ syntax error");
    const verdict = await regrade();
    expect(verdict.correct).toBe(false);
    expect(verdict.reason).toMatch(/could not be run/i);
    expect(verdict.regressions).toEqual([]);
  }, 120_000);

  it("does not accept deleting the test as a way of passing it", async () => {
    write(ws, "src/pagination.ts", golden(f, "src/pagination.ts"));
    fs.rmSync(path.join(ws.root, "src/pagination.test.ts"));
    const verdict = await regrade();
    expect(verdict.correct).toBe(false);
    expect(verdict.stillFailing).toContain("a full page contains every item in the page");
    // Restore, so the shared workspace does not poison a later case.
    write(ws, "src/pagination.test.ts", fs.readFileSync(path.join(f.dir, "repo/src/pagination.test.ts"), "utf8"));
  }, 120_000);

  it("rejects correct code carrying a broken test of the agent's own", async () => {
    // Tests failing, code correct. The grader trusts the suite, and the reason says the suite is
    // red rather than blaming the required tests, so the failure lands in the right class.
    write(ws, "src/pagination.ts", golden(f, "src/pagination.ts"));
    write(
      ws,
      "src/extra.test.ts",
      ['import test from "node:test";', 'import assert from "node:assert/strict";', 'test("agent added this", () => assert.equal(1, 2));'].join("\n")
    );
    const verdict = await regrade();
    expect(verdict.correct).toBe(false);
    expect(verdict.stillFailing).toEqual([]);
    expect(verdict.reason).toMatch(/exits [1-9]/);
    fs.rmSync(path.join(ws.root, "src/extra.test.ts"));
  }, 120_000);
});

// ── Python ───────────────────────────────────────────────────────────────────

describe("Python fixture", () => {
  const f = fixture(PY);
  let ws: Workspace;

  beforeAll(async () => {
    ws = materialise(f);
    await setupWorkspace(f, ws);
  }, 300_000);
  afterAll(() => ws?.dispose());

  it("accepts the correct fix, through pytest's own report", async () => {
    write(ws, "billing/periods.py", golden(f, "billing/periods.py"));
    const verdict = await grade(f, ws, "");
    expect(verdict.correct, verdict.reason).toBe(true);
  }, 300_000);

  it("rejects a fix that satisfies only the visible example", async () => {
    // Special-casing equal dates passes the single-day test and is wrong for every real range.
    write(
      ws,
      "billing/periods.py",
      mutate(
        golden(f, "billing/periods.py"),
        "return (end - start).days + 1",
        "return 1 if start == end else (end - start).days"
      )
    );
    const verdict = await grade(f, ws, "");
    expect(verdict.correct).toBe(false);
    expect(verdict.stillFailing.some(t => t.includes("week"))).toBe(true);
  }, 300_000);

  it("rejects an empty diff", async () => {
    write(ws, "billing/periods.py", fs.readFileSync(path.join(f.dir, "repo/billing/periods.py"), "utf8"));
    const verdict = await grade(f, ws, "");
    expect(verdict.correct).toBe(false);
    expect(verdict.stillFailing.length).toBeGreaterThan(0);
  }, 300_000);
});

// ── Both attribute orders, end to end ────────────────────────────────────────

describe("JUnit attribute order", () => {
  it("is the same for the order Node emits and the order pytest emits", () => {
    const nodeStyle = '<testcase name="does a thing" time="0.1" classname="suite"/>';
    const pytestStyle = '<testcase classname="suite" name="does a thing" time="0.1" />';
    expect([...parseJUnit(nodeStyle).keys()]).toEqual(["suite.does a thing"]);
    expect([...parseJUnit(pytestStyle).keys()]).toEqual(["suite.does a thing"]);
  });

  it("reads a failure in either order", () => {
    const a = '<testcase name="x" classname="s"><failure message="m">d</failure></testcase>';
    const b = '<testcase classname="s" name="x"><failure message="m">d</failure></testcase>';
    expect(parseJUnit(a).get("s.x")).toBe("failed");
    expect(parseJUnit(b).get("s.x")).toBe("failed");
  });
});

// ── The refactor grader ──────────────────────────────────────────────────────

/**
 * A synthetic fixture, built here rather than added to the benchmark.
 *
 * The refactor grader has no fixture of its own yet, and the partial-change case is the one it
 * exists for: a rename applied to some files leaves a green suite, because the files that still
 * carry the old name are not the ones the tests exercise.
 */
describe("Refactor grading", () => {
  let dir: string;
  let f: LoadedFixture;

  const FILES = ["core.ts", "a.ts", "b.ts", "legacy_one.ts", "legacy_two.ts"];

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-refactor-case-"));
    const repo = path.join(dir, "repo", "src");
    fs.mkdirSync(repo, { recursive: true });

    fs.writeFileSync(path.join(repo, "core.ts"), "export function oldCalc(n: number): number {\n  return n * 2;\n}\n");
    for (const name of ["a.ts", "b.ts", "legacy_one.ts", "legacy_two.ts"]) {
      fs.writeFileSync(
        path.join(repo, name),
        `import { oldCalc } from "./core.ts";\n\nexport const ${name.replace(".ts", "")}Value = oldCalc(${name.length});\n`
      );
    }
    // Exercises core, a and b only, so a rename that misses the two legacy files still runs green.
    fs.writeFileSync(
      path.join(repo, "usage.test.ts"),
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'import { aValue } from "./a.ts";',
        'import { bValue } from "./b.ts";',
        'test("values are doubled", () => {',
        "  assert.equal(aValue, 8);",
        "  assert.equal(bValue, 8);",
        "});"
      ].join("\n")
    );

    const spec: FixtureSpec = {
      id: "synthetic-refactor",
      tier: "T3",
      ecosystem: "typescript",
      description: "rename oldCalc to computeTotal across five files",
      prompt: "Rename oldCalc to computeTotal everywhere.",
      grader: {
        kind: "refactor",
        tests: {
          kind: "tests",
          command: {
            executable: "node",
            args: [
              "--experimental-strip-types",
              "--test",
              "--test-reporter=junit",
              "--test-reporter-destination=reports/junit.xml"
            ]
          },
          junitPath: "reports/junit.xml"
        },
        forbidden: ["oldCalc"],
        required: [{ path: "src/core.ts", contains: ["computeTotal"] }]
      },
      allowedPaths: ["src/"]
    };
    fs.writeFileSync(path.join(dir, "task.json"), JSON.stringify(spec, null, 2));
    f = { spec, dir };
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const rename = (ws: Workspace, files: string[]) => {
    for (const name of files) {
      const rel = `src/${name}`;
      const target = path.join(ws.root, rel);
      write(ws, rel, fs.readFileSync(target, "utf8").replaceAll("oldCalc", "computeTotal"));
    }
  };

  it("accepts a rename applied everywhere", async () => {
    const ws = materialise(f);
    try {
      rename(ws, FILES);
      const verdict = await grade(f, ws, "");
      expect(verdict.correct, verdict.reason).toBe(true);
    } finally {
      ws.dispose();
    }
  }, 120_000);

  it("rejects a rename applied to three of five files, despite a green suite", async () => {
    const ws = materialise(f);
    try {
      rename(ws, ["core.ts", "a.ts", "b.ts"]);
      const verdict = await grade(f, ws, "");
      expect(verdict.correct).toBe(false);
      expect(verdict.reason).toContain("legacy_one.ts");
      expect(verdict.reason).toContain("legacy_two.ts");
      expect(verdict.reason).toMatch(/green but the refactor is incomplete/i);
    } finally {
      ws.dispose();
    }
  }, 120_000);

  it("rejects a rename that misses the file the fixture names explicitly", async () => {
    const ws = materialise(f);
    try {
      rename(ws, ["a.ts", "b.ts", "legacy_one.ts", "legacy_two.ts"]);
      const verdict = await grade(f, ws, "");
      expect(verdict.correct).toBe(false);
      expect(verdict.reason).toContain("src/core.ts");
    } finally {
      ws.dispose();
    }
  }, 120_000);
});
