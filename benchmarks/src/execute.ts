import {
  assertWithheldAbsent,
  changedFiles,
  materialise,
  unnecessaryChanges,
  type LoadedFixture
} from "./fixture.js";
import { grade, setupWorkspace } from "./graders.js";
import { assembleRecord } from "./metrics.js";
import { runTask } from "./runner.js";
import type { RunRecord } from "./types.js";

/**
 * One fixture, once.
 *
 * Separate from the command line so the harness's own tests drive exactly the path a real run
 * takes. A benchmark whose tests exercise a parallel code path is measuring something other than
 * what it reports.
 */
export interface ExecuteInput {
  fixture: LoadedFixture;
  rep: number;
  baseUrl: string;
  headers: Record<string, string>;
  model: { id: string; provider: string };
  contextWindow: number;
  timeoutMs: number;
}

export async function executeFixture(input: ExecuteInput): Promise<RunRecord> {
  const { fixture } = input;
  const workspace = materialise(fixture);
  const startedAt = new Date().toISOString();
  const began = Date.now();

  try {
    await setupWorkspace(fixture, workspace);

    const outcome = await runTask({
      baseUrl: input.baseUrl,
      headers: input.headers,
      prompt: fixture.spec.prompt,
      modelId: input.model.id,
      workspaceRoot: workspace.root,
      mode: fixture.spec.mode,
      autonomy: fixture.spec.autonomy ?? "ask",
      limits: fixture.spec.limits,
      timeoutMs: input.timeoutMs
    });

    // Checked before the grader installs anything: the agent must not have produced a file where a
    // grader-only test belongs, or the grader would silently overwrite its work.
    assertWithheldAbsent(fixture, workspace.root, "after the run");

    const changed = changedFiles(workspace);
    const verdict = await grade(fixture, workspace, outcome.finalText);

    return assembleRecord({
      fixtureId: fixture.spec.id,
      tier: fixture.spec.tier,
      ecosystem: fixture.spec.ecosystem,
      rep: input.rep,
      model: input.model,
      startedAt,
      durationMs: Date.now() - began,
      contextWindow: input.contextWindow,
      outcome,
      verdict,
      filesChanged: changed,
      unnecessary: unnecessaryChanges(changed, fixture.spec.allowedPaths)
    });
  } finally {
    workspace.dispose();
  }
}
