import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FixtureSpec, Tier } from "./types.js";

/**
 * Fixture loading and workspace materialisation.
 *
 * Every run starts from a byte-identical tree. The fixture is pinned by construction rather than by
 * an upstream commit: the sources live in this repository, and the harness builds a fresh git
 * repository from them for each run. That removes the network, upstream drift and rate limits from
 * a measurement whose whole purpose is to be comparable across months.
 */

export interface LoadedFixture {
  spec: FixtureSpec;
  /** Directory holding repo/, golden/ and withheld/. */
  dir: string;
}

export function fixturesRoot(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "fixtures");
}

export function loadFixtures(root: string, filter?: { tier?: Tier; ids?: string[] }): LoadedFixture[] {
  if (!fs.existsSync(root)) return [];
  const loaded: LoadedFixture[] = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const specPath = path.join(dir, "task.json");
    if (!fs.existsSync(specPath)) continue;

    const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as FixtureSpec;
    if (spec.id !== entry.name) {
      throw new Error(`Fixture ${entry.name}: task.json declares id '${spec.id}'; the directory name is the id.`);
    }
    if (!fs.existsSync(path.join(dir, "repo"))) {
      throw new Error(`Fixture ${spec.id}: no repo/ directory.`);
    }
    if (filter?.tier && spec.tier !== filter.tier) continue;
    if (filter?.ids && !filter.ids.includes(spec.id)) continue;
    loaded.push({ spec, dir });
  }

  return loaded;
}

/**
 * Directories a tool creates, which are not the agent's work.
 *
 * Counting them turned a clean Python run into five unnecessary changes, which would have been
 * recorded as the agent touching files outside the golden set and could have classified a correct
 * run as a failure.
 *
 * These names are artefacts wherever they appear, so they are skipped at any depth.
 */
const RUNNER_ARTEFACTS = [".git", "node_modules", ".venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox"];

/**
 * Artefacts only at the top of the workspace.
 *
 * The grader writes its JUnit report to `reports/junit.xml` in the workspace root. "reports" is an
 * ordinary name for a source directory, though, so skipping it at every depth would make a real
 * `src/reports/` invisible to the pristine check, to change detection and to the forbidden-string
 * scan: a refactor could leave the old symbol there and be graded as complete.
 */
const ROOT_ONLY_ARTEFACTS = ["reports"];

export function listFiles(root: string, skip: Set<string> = new Set(RUNNER_ARTEFACTS)): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      if (prefix === "" && ROOT_ONLY_ARTEFACTS.includes(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else out.push(rel);
    }
  };
  if (fs.existsSync(root)) walk(root, "");
  return out.sort();
}

function copyTree(from: string, to: string) {
  fs.mkdirSync(to, { recursive: true });
  for (const rel of listFiles(from)) {
    const target = path.join(to, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(from, rel), target);
  }
}

function sha(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export class LeakageError extends Error {}

/**
 * Before the agent starts, the workspace must be exactly the fixture's repo/ tree.
 *
 * This is the airtight form of "the answer is not in the workspace": not a search for suspicious
 * content, but an assertion that nothing beyond the pinned sources is present at all. The likeliest
 * way a golden solution reaches the agent is a harness bug, and this catches every one of them.
 */
export function assertWorkspaceIsPristine(fixture: LoadedFixture, workspace: string): void {
  const expected = new Map<string, string>();
  const repoDir = path.join(fixture.dir, "repo");
  for (const rel of listFiles(repoDir)) {
    expected.set(rel, sha(fs.readFileSync(path.join(repoDir, rel))));
  }

  const problems: string[] = [];
  const actual = listFiles(workspace);
  for (const rel of actual) {
    const want = expected.get(rel);
    if (want === undefined) {
      problems.push(`${rel} is present but is not part of repo/`);
    } else if (want !== sha(fs.readFileSync(path.join(workspace, rel)))) {
      problems.push(`${rel} differs from repo/`);
    }
  }
  for (const rel of expected.keys()) {
    if (!actual.includes(rel)) problems.push(`${rel} is missing from the workspace`);
  }

  if (problems.length > 0) {
    throw new LeakageError(
      [`Fixture ${fixture.spec.id}: the starting workspace is not the pinned tree:`, ...problems].join("\n  ")
    );
  }
}

/**
 * No file may sit at a path the grader's withheld tests occupy.
 *
 * Checked before the run and again after it, before the withheld tests are installed. If the agent
 * could see them it could satisfy the specific assertions rather than the requirement, and if it
 * created a file at one of those paths the grader would silently overwrite its work.
 *
 * Deliberately a path check and not a content check. The golden solution is the correct answer, so
 * an agent that succeeds will legitimately produce files identical to it; treating that as leakage
 * would flag every success as cheating.
 */
export function assertWithheldAbsent(fixture: LoadedFixture, workspace: string, when: string): void {
  const withheld = path.join(fixture.dir, "withheld");
  if (!fs.existsSync(withheld)) return;

  const present = listFiles(withheld).filter(rel => fs.existsSync(path.join(workspace, rel)));
  if (present.length > 0) {
    throw new LeakageError(
      [`Fixture ${fixture.spec.id}: grader-only tests are in the agent's workspace ${when}:`, ...present].join("\n  ")
    );
  }
}

export interface Workspace {
  root: string;
  /** Files and their hashes as the agent first saw them, for change detection. */
  baseline: Map<string, string>;
  dispose: () => void;
}

/** Copies the fixture's sources into a fresh temporary git repository. */
export function materialise(fixture: LoadedFixture): Workspace {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `comu-bench-${fixture.spec.id}-`));
  copyTree(path.join(fixture.dir, "repo"), root);

  const git = (...args: string[]) => {
    try {
      execFileSync("git", args, { cwd: root, stdio: "ignore" });
    } catch {
      // A fixture without git still runs; only the change listing degrades.
    }
  };
  git("init", "-b", "main");
  git("config", "user.email", "benchmark@comu.invalid");
  git("config", "user.name", "COMU Benchmark");
  git("add", ".");
  git("commit", "-m", "fixture baseline");

  assertWorkspaceIsPristine(fixture, root);
  assertWithheldAbsent(fixture, root, "before the run");

  const baseline = new Map<string, string>();
  for (const rel of listFiles(root)) {
    baseline.set(rel, sha(fs.readFileSync(path.join(root, rel))));
  }

  return {
    root,
    baseline,
    dispose: () => fs.rmSync(root, { recursive: true, force: true })
  };
}

/** Files whose content differs from the baseline, plus anything added or removed. */
export function changedFiles(workspace: Workspace): string[] {
  const now = listFiles(workspace.root);
  const changed: string[] = [];
  for (const rel of now) {
    const digest = sha(fs.readFileSync(path.join(workspace.root, rel)));
    if (workspace.baseline.get(rel) !== digest) changed.push(rel);
  }
  for (const rel of workspace.baseline.keys()) {
    if (!now.includes(rel)) changed.push(`${rel} (deleted)`);
  }
  return changed.sort();
}

/** Changes outside what the golden solution touches. A prefix ending in "/" matches a directory. */
export function unnecessaryChanges(changed: string[], allowed: string[]): string[] {
  return changed.filter(rel => {
    const bare = rel.replace(/ \(deleted\)$/, "");
    return !allowed.some(a => (a.endsWith("/") ? bare.startsWith(a) : bare === a));
  });
}

/**
 * Copies the grader-only tests in, after the agent has finished and the workspace is sealed.
 *
 * Kept out of the agent's reach until this moment so it cannot write code that satisfies the
 * specific assertions rather than the requirement.
 */
export function installWithheld(fixture: LoadedFixture, workspace: Workspace): void {
  const withheld = path.join(fixture.dir, "withheld");
  if (!fs.existsSync(withheld)) return;
  copyTree(withheld, workspace.root);
}
