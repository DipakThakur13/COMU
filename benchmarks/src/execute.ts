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
import { assertNoSecret } from "./secrets.js";
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
  /** Runs in flight, recorded with the result so a mixed journal stays readable. */
  concurrency: number;
  timeoutMs: number;
  /** Applied when the fixture does not set its own, so a whole run can share a raised budget. */
  limits?: Record<string, number>;
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
      limits: fixture.spec.limits ?? input.limits,
      timeoutMs: input.timeoutMs
    });

    // Checked before the grader installs anything: the agent must not have produced a file where a
    // grader-only test belongs, or the grader would silently overwrite its work.
    assertWithheldAbsent(fixture, workspace.root, "after the run");

    // The journal is the largest thing a run produces and the likeliest place for a credential to
    // surface, because a provider echoes the request back in some error messages.
    assertNoSecret(outcome.events, `the event journal for ${fixture.spec.id}`);

    const changed = changedFiles(workspace);
    /*
     * What the agent actually said.
     *
     * finalText is the assistant's closing message only when the task completed. On any other
     * ending it holds the error instead, so preferring it graded an onboarding answer against a
     * runtime error message and scored zero however good the answer was. The streamed prose is the
     * fallback, and it is what the rubric tier is really grading.
     */
    const streamed = outcome.assistantText.trim();
    const answer =
      outcome.status === "completed" && outcome.finalText.trim() ? outcome.finalText : streamed || outcome.finalText;
    const verdict = await grade(fixture, workspace, answer);

    const record = assembleRecord({
      fixtureId: fixture.spec.id,
      tier: fixture.spec.tier,
      ecosystem: fixture.spec.ecosystem,
      rep: input.rep,
      model: input.model,
      startedAt,
      durationMs: Date.now() - began,
      contextWindow: input.contextWindow,
      concurrency: input.concurrency,
      outcome: { ...outcome, finalText: answer },
      verdict,
      filesChanged: changed,
      unnecessary: unnecessaryChanges(changed, fixture.spec.allowedPaths)
    });

    assertNoSecret(record, `the run record for ${fixture.spec.id}`);
    return record;
  } finally {
    workspace.dispose();
  }
}
