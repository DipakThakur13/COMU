import type { AgentEvent } from "@comu/protocol";
import type { FailureClass, GraderVerdict, RunRecord } from "./types.js";
import type { TaskOutcome } from "./runner.js";

/**
 * Turning a run into a row.
 *
 * The failure taxonomy exists so that a change can be shown to have moved its own target class
 * without creating a new one. A single pass rate cannot show that: a fix that removes five context
 * overflows and introduces four planning misses looks like progress and is not.
 */

/** Provider wording for a prompt that did not fit. Matched case-insensitively against error text. */
const OVERFLOW_SIGNATURES = [
  "context_length_exceeded",
  "maximum context length",
  "context window",
  "too many tokens",
  "reduce the length of the messages",
  "input is too long",
  "prompt is too long"
];

/** Enough of an answer to judge it, bounded so a result file stays readable. */
const MAX_ANSWER_CHARS = 20_000;

const TRUNCATION_SIGNATURES = ["max steps", "max tool calls", "execution time", "limit was reached"];

function errorTextOf(events: AgentEvent[], outcome: TaskOutcome): string {
  const parts: string[] = [outcome.finalText];
  for (const event of events) {
    const e = event as unknown as Record<string, any>;
    if (event.type === "model_request.failed") parts.push(String(e.error ?? e.message ?? ""));
    if (event.type === "task.failed") parts.push(String(e.error ?? ""), String(e.payload?.message ?? ""));
  }
  return parts.join(" \n ").toLowerCase();
}

function hasEvent(events: AgentEvent[], type: string): boolean {
  return events.some(e => e.type === type);
}

export interface ClassifyInput {
  outcome: TaskOutcome;
  verdict: GraderVerdict;
  unnecessary: string[];
  peakContextRatio: number;
}

/**
 * The single reason this run did not produce correct work.
 *
 * Ordered, first match wins, most specific cause first. A run the grader accepts has no failure
 * class even when it was untidy; untidiness is recorded separately so it can be counted without
 * being confused with failure.
 */
export function classifyFailure({ outcome, verdict, unnecessary, peakContextRatio }: ClassifyInput): FailureClass | null {
  if (verdict.correct) return null;

  const text = errorTextOf(outcome.events, outcome);

  if (OVERFLOW_SIGNATURES.some(sig => text.includes(sig)) || peakContextRatio >= 1) {
    return "context_overflow";
  }
  if (outcome.limitReached || TRUNCATION_SIGNATURES.some(sig => text.includes(sig))) {
    return "loop_truncation";
  }
  if (outcome.verificationStatus === "UNAVAILABLE" || text.includes("unavailable")) {
    return "verification_unavailable";
  }
  if (outcome.status === "failed" && text.includes("provider")) {
    return "provider_error";
  }
  if (verdict.regressions.length > 0) {
    return "regression_introduced";
  }
  if (outcome.status === "failed" && hasEvent(outcome.events, "tool.failed")) {
    return "tool_error_unrecovered";
  }
  if (unnecessary.length > 0) {
    return "unnecessary_changes";
  }
  // The task ran to completion, nothing broke, and the work is still wrong. That is the plan not
  // covering what the task actually needed.
  if (outcome.status === "completed") {
    return "planning_miss";
  }
  return "grader_failed_other";
}

export interface AssembleInput {
  fixtureId: string;
  tier: RunRecord["tier"];
  ecosystem: RunRecord["ecosystem"];
  rep: number;
  model: { id: string; provider: string };
  startedAt: string;
  durationMs: number;
  contextWindow: number;
  outcome: TaskOutcome;
  verdict: GraderVerdict;
  filesChanged: string[];
  unnecessary: string[];
}

export function assembleRecord(input: AssembleInput): RunRecord {
  const { outcome, verdict } = input;
  const peakContextRatio = input.contextWindow > 0 ? outcome.peakPromptTokens / input.contextWindow : 0;

  // The two directions of disagreement between COMU and reality. Named separately because they
  // have different causes and different costs: one destroys trust, the other wastes work.
  const falseCompletion = outcome.status === "completed" && !verdict.correct;
  const falseFailure = outcome.status !== "completed" && verdict.correct;

  return {
    fixtureId: input.fixtureId,
    tier: input.tier,
    ecosystem: input.ecosystem,
    rep: input.rep,
    model: input.model,
    limits: outcome.limits,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    comuStatus: outcome.status,
    finalAnswer: outcome.finalText.slice(0, MAX_ANSWER_CHARS),
    grader: verdict,
    falseCompletion,
    falseFailure,
    unnecessaryChanges: input.unnecessary,
    filesChanged: input.filesChanged,
    approvalsRequested: outcome.approvalsRequested,
    clarificationsRequested: outcome.clarificationsRequested,
    toolCalls: outcome.toolCalls,
    modelRequests: outcome.modelRequests,
    promptTokens: outcome.promptTokens,
    completionTokens: outcome.completionTokens,
    peakPromptTokens: outcome.peakPromptTokens,
    contextWindow: input.contextWindow,
    peakContextRatio: Number(peakContextRatio.toFixed(4)),
    planSteps: outcome.planSteps,
    planVersions: outcome.planVersions,
    repairAttempts: outcome.repairAttempts,
    repairRecovered: outcome.repairRecovered,
    verificationStatus: outcome.verificationStatus,
    failureClass: classifyFailure({
      outcome,
      verdict,
      unnecessary: input.unnecessary,
      peakContextRatio
    }),
    harnessError: outcome.harnessError
  };
}

/** Median with the observed range, which is what a noise judgement needs. A mean hides spread. */
export interface Spread {
  median: number;
  min: number;
  max: number;
}

export interface Summary {
  runs: number;
  correct: number;
  falseCompletions: number;
  falseFailures: number;
  durationMs: Spread;
  promptTokens: Spread;
  maxPeakContextRatio: number;
  failureCounts: Record<string, number>;
  /**
   * Per fixture, how many of its repetitions were correct.
   *
   * The primary result. A pooled rate averages a fixture that always works with one that never
   * does and reports something true of neither, and it hides the case this benchmark most needs to
   * see: a fixture that succeeds three times in five is a different product from one that succeeds
   * five in five.
   */
  perFixture: Array<{ fixtureId: string; tier: string; correct: number; of: number }>;
  /** Fixtures that always, sometimes and never produced correct work. */
  reliability: { always: number; sometimes: number; never: number };
}

function spread(values: number[]): Spread {
  if (values.length === 0) return { median: 0, min: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
  return { median, min: sorted[0], max: sorted[sorted.length - 1] };
}

export function summarise(records: RunRecord[]): Summary {
  const correct = records.filter(r => r.grader.correct);
  const failureCounts: Record<string, number> = {};
  for (const record of records) {
    if (record.failureClass) failureCounts[record.failureClass] = (failureCounts[record.failureClass] ?? 0) + 1;
  }

  const byFixture = new Map<string, { tier: string; correct: number; of: number }>();
  for (const record of records) {
    const entry = byFixture.get(record.fixtureId) ?? { tier: record.tier, correct: 0, of: 0 };
    entry.of += 1;
    if (record.grader.correct) entry.correct += 1;
    byFixture.set(record.fixtureId, entry);
  }

  const perFixture = [...byFixture.entries()]
    .map(([fixtureId, v]) => ({ fixtureId, tier: v.tier, correct: v.correct, of: v.of }))
    .sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));

  return {
    runs: records.length,
    correct: correct.length,
    falseCompletions: records.filter(r => r.falseCompletion).length,
    falseFailures: records.filter(r => r.falseFailure).length,
    durationMs: spread(records.map(r => r.durationMs)),
    promptTokens: spread(records.map(r => r.promptTokens)),
    maxPeakContextRatio: records.reduce((max, r) => Math.max(max, r.peakContextRatio), 0),
    failureCounts,
    perFixture,
    reliability: {
      always: perFixture.filter(f => f.correct === f.of).length,
      sometimes: perFixture.filter(f => f.correct > 0 && f.correct < f.of).length,
      never: perFixture.filter(f => f.correct === 0).length
    }
  };
}
