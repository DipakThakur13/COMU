import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  installWithheld,
  listFiles,
  materialise,
  type LoadedFixture,
  type Workspace
} from "./fixture.js";
import type { Command, GraderSpec, GraderVerdict, RefactorGrader, RubricGrader, TestsGrader } from "./types.js";

const run = promisify(execFile);

/**
 * Deciding whether the work was actually done.
 *
 * No grader reads COMU's status, its final message, or any event it emitted. Each one runs the
 * code and looks at the workspace. That independence is the point: the benchmark exists because
 * self-reported success is exactly the thing that cannot be trusted.
 */

export type TestOutcome = "passed" | "failed" | "skipped";

export interface SuiteResult {
  exitCode: number;
  /** Test identifier to outcome. Identifiers are "classname.name" as JUnit reports them. */
  tests: Map<string, TestOutcome>;
  output: string;
  /** Set when the suite could not be run at all, as opposed to running and failing. */
  unrunnable?: string;
}

/**
 * Resolves the placeholders a fixture may use in a command.
 *
 * {PYTHON} is the interpreter of the virtual environment the fixture created in its own workspace.
 * Fixtures declare it rather than a path because the layout differs by platform, and a benchmark
 * that only runs on one operating system is not much of a benchmark.
 */
export function resolveCommand(command: Command, cwd: string): Command {
  const venvPython =
    process.platform === "win32" ? path.join(cwd, ".venv", "Scripts", "python.exe") : path.join(cwd, ".venv", "bin", "python");
  const substitute = (value: string) => value.replace("{PYTHON}", venvPython);
  return { executable: substitute(command.executable), args: command.args.map(substitute) };
}

export async function execute(rawCommand: Command, cwd: string, timeoutMs = 300_000): Promise<{ code: number; out: string }> {
  const command = resolveCommand(rawCommand, cwd);
  try {
    const { stdout, stderr } = await run(command.executable, command.args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    });
    return { code: 0, out: `${stdout}\n${stderr}` };
  } catch (error) {
    const e = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message ?? ""}`;
    return { code: typeof e.code === "number" ? e.code : 1, out };
  }
}

/**
 * Parses JUnit XML, which both ecosystems emit natively: `vitest --reporter=junit` and
 * `pytest --junit-xml`. Using one interchange format keeps a single parser honest across both,
 * rather than two brittle readers of human-facing console output.
 */
export function parseJUnit(xml: string): Map<string, TestOutcome> {
  const tests = new Map<string, TestOutcome>();
  const casePattern = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  const attr = (source: string, name: string): string => {
    // The leading boundary is load-bearing: without it, looking up "name" matches the tail of
    // classname="..." and every pytest test comes back identified by its module twice over. Node
    // happens to emit name before classname, so the defect is invisible on one ecosystem.
    const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(source);
    return match ? match[1] : "";
  };

  for (const match of xml.matchAll(casePattern)) {
    const attrs = match[1];
    const body = match[3] ?? "";
    const classname = attr(attrs, "classname");
    const name = attr(attrs, "name");
    const id = [classname, name].filter(Boolean).join(".") || name || classname;
    if (!id) continue;

    let outcome: TestOutcome = "passed";
    if (/<(failure|error)\b/.test(body)) outcome = "failed";
    else if (/<skipped\b/.test(body)) outcome = "skipped";
    tests.set(id, outcome);
  }
  return tests;
}

/** Runs a fixture's suite in a workspace and reads back the JUnit report it wrote. */
export async function runSuite(spec: TestsGrader, workspace: string): Promise<SuiteResult> {
  const reportPath = path.join(workspace, spec.junitPath);
  fs.rmSync(reportPath, { force: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const { code, out } = await execute(spec.command, workspace);
  if (!fs.existsSync(reportPath)) {
    // No report means the runner never started: a missing dependency, a syntax error at import
    // time, a command that is not installed. That is not the same as a failing test and must not
    // be recorded as one.
    return { exitCode: code, tests: new Map(), output: out, unrunnable: `no JUnit report at ${spec.junitPath}` };
  }
  return { exitCode: code, tests: parseJUnit(fs.readFileSync(reportPath, "utf8")), output: out };
}

/**
 * The suite's result on the pristine fixture, with the withheld tests installed.
 *
 * Computed once per fixture and reused across repetitions, because the starting tree is identical
 * every time. Without it there is no way to tell a test the agent broke from one that never passed.
 */
/*
 * Holds the promise rather than the result.
 *
 * Runs execute concurrently, so two repetitions of the same fixture can ask for the baseline at the
 * same moment. Caching the finished result would let both start their own copy: two virtual
 * environments, two suite runs, and a race over which answer is kept. Caching the promise means the
 * first caller does the work and the rest wait on it.
 */
const baselineCache = new Map<string, Promise<SuiteResult>>();

export function baselineSuite(fixture: LoadedFixture, spec: TestsGrader): Promise<SuiteResult> {
  const cached = baselineCache.get(fixture.spec.id);
  if (cached) return cached;

  const pending = (async () => {
    const pristine = materialise(fixture);
    try {
      installWithheld(fixture, pristine);
      await setupWorkspace(fixture, pristine);
      return await runSuite(spec, pristine.root);
    } finally {
      pristine.dispose();
    }
  })();

  baselineCache.set(fixture.spec.id, pending);
  // A failed baseline must not be cached as the answer for every later run of this fixture.
  pending.catch(() => baselineCache.delete(fixture.spec.id));
  return pending;
}

/** Runs a fixture's declared setup commands, for example creating a pinned Python environment. */
export async function setupWorkspace(fixture: LoadedFixture, workspace: Workspace): Promise<void> {
  for (const command of fixture.spec.setup?.commands ?? []) {
    const { code, out } = await execute(command, workspace.root, 600_000);
    if (code !== 0) {
      throw new Error(`Fixture ${fixture.spec.id}: setup command failed: ${command.executable} ${command.args.join(" ")}\n${out.slice(0, 2000)}`);
    }
  }
}

async function gradeTests(fixture: LoadedFixture, spec: TestsGrader, workspace: Workspace): Promise<GraderVerdict> {
  const before = await baselineSuite(fixture, spec);
  installWithheld(fixture, workspace);
  const after = await runSuite(spec, workspace.root);

  if (after.unrunnable) {
    return {
      correct: false,
      reason: `The test suite could not be run after the change (${after.unrunnable}).`,
      regressions: [],
      stillFailing: []
    };
  }

  /*
   * Tests that were in the baseline and are now absent entirely.
   *
   * A change that stops a module importing does not produce failing tests, it produces no tests:
   * Node reports one failing case for the whole file and pytest reports a collection error, and in
   * both the individual cases simply disappear. Calling that "the required tests still fail" would
   * put it in the wrong failure class and read as a wrong fix rather than a broken workspace.
   *
   * The threshold is half, so deleting one test file is still graded as deleting a test file.
   */
  const baselineIds = [...before.tests.keys()];
  const vanished = baselineIds.filter(id => !after.tests.has(id));
  if (baselineIds.length > 0 && vanished.length >= Math.ceil(baselineIds.length / 2)) {
    return {
      correct: false,
      reason: `The test suite could not be run after the change: ${vanished.length} of ${baselineIds.length} tests no longer report at all.`,
      regressions: [],
      stillFailing: []
    };
  }

  const regressions = [...after.tests.entries()]
    .filter(([id, outcome]) => outcome === "failed" && before.tests.get(id) === "passed")
    .map(([id]) => id)
    .sort();

  const required = spec.mustPass ?? [];
  const stillFailing = required
    .filter(fragment => {
      const matches = [...after.tests.entries()].filter(([id]) => id.includes(fragment));
      // A required test that vanished counts as still failing: deleting the test is not a fix.
      return matches.length === 0 || matches.some(([, outcome]) => outcome !== "passed");
    })
    .sort();

  const green = after.exitCode === 0;
  const correct = green && stillFailing.length === 0 && regressions.length === 0;

  let reason = "The suite is green and every required test passes.";
  if (!green) reason = `The test suite exits ${after.exitCode}.`;
  if (stillFailing.length > 0) reason = `Required tests still failing: ${stillFailing.join(", ")}.`;
  if (regressions.length > 0) reason = `Previously passing tests now fail: ${regressions.join(", ")}.`;

  return { correct, reason, regressions, stillFailing };
}

async function gradeRefactor(fixture: LoadedFixture, spec: RefactorGrader, workspace: Workspace): Promise<GraderVerdict> {
  const tests = await gradeTests(fixture, spec.tests, workspace);

  // Source files only. The JUnit report and any build output are the harness's own leavings.
  const sources = listFiles(workspace.root).filter(rel => !rel.startsWith("reports/") && !rel.endsWith(".xml"));
  const leftovers: string[] = [];
  for (const rel of sources) {
    const content = fs.readFileSync(path.join(workspace.root, rel), "utf8");
    for (const term of spec.forbidden) {
      if (content.includes(term)) leftovers.push(`${rel} still contains "${term}"`);
    }
  }

  const missing: string[] = [];
  for (const requirement of spec.required) {
    const abs = path.join(workspace.root, requirement.path);
    if (!fs.existsSync(abs)) {
      missing.push(`${requirement.path} is missing`);
      continue;
    }
    const content = fs.readFileSync(abs, "utf8");
    for (const term of requirement.contains) {
      if (!content.includes(term)) missing.push(`${requirement.path} does not contain "${term}"`);
    }
  }

  const problems = [...leftovers, ...missing];
  if (problems.length > 0) {
    return {
      ...tests,
      correct: false,
      // A green suite with the old name still present is a refactor that was not performed.
      reason: `${tests.correct ? "The suite is green but the refactor is incomplete" : tests.reason} ${problems.join("; ")}.`
    };
  }
  return tests;
}

/**
 * Grades the agent's answer against a checklist.
 *
 * Every point is a fact, matched by any one of several patterns so that wording is free. There is
 * no model in this path on purpose: a judge model would make the benchmark's verdict depend on the
 * thing the benchmark measures.
 */
export function gradeRubric(spec: RubricGrader, answer: string): GraderVerdict {
  const scored: string[] = [];
  const missed: string[] = [];

  for (const point of spec.points) {
    const hit = point.anyOf.some(pattern => new RegExp(pattern, "i").test(answer));
    (hit ? scored : missed).push(point.id);
  }

  const fraction = spec.points.length === 0 ? 0 : scored.length / spec.points.length;
  const correct = fraction >= spec.passThreshold;
  return {
    correct,
    reason: `Scored ${scored.length} of ${spec.points.length} rubric points (threshold ${Math.round(spec.passThreshold * 100)}%).${missed.length ? ` Missed: ${missed.join(", ")}.` : ""}`,
    regressions: [],
    stillFailing: [],
    rubric: { scored, missed, fraction }
  };
}

export async function grade(
  fixture: LoadedFixture,
  workspace: Workspace,
  finalAnswer: string
): Promise<GraderVerdict> {
  const spec: GraderSpec = fixture.spec.grader;
  if (spec.kind === "tests") return gradeTests(fixture, spec, workspace);
  if (spec.kind === "refactor") return gradeRefactor(fixture, spec, workspace);
  return gradeRubric(spec, finalAnswer);
}

/** Exposed so a self test can prove the baseline cache does not leak between fixtures. */
export function resetBaselineCache(): void {
  baselineCache.clear();
}
