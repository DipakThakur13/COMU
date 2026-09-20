import type { AgentEvent } from "@comu/protocol";
import type { FailureClass, GraderVerdict, ProviderFailureCounts, RunRecord } from "./types.js";

/**
 * Records written before the breakdown existed carry no counts, so every read defaults to zero.
 */
const FAILURE_KEYS = ["timeouts", "rateLimits", "gateway", "other"] as const;
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

/**
 * Paths that are a tool's output rather than the agent's work.
 *
 * Applied when reading a record, not only when writing one. A run takes hours, so a correction to
 * what counts as a change cannot reach records already written, and B0's were all written before
 * compiled output was excluded: two T7 onboarding questions, which are answered rather than edited,
 * were each recorded as making thirty-three unnecessary changes because a build had emitted
 * `dist/*.js`.
 */
const GENERATED_PREFIXES = ["dist/", "build/", "coverage/", "reports/", "node_modules/", ".venv/"];

export function agentAuthored(paths: string[]): string[] {
  return paths.filter(p => !GENERATED_PREFIXES.some(prefix => p.startsWith(prefix)));
}

/**
 * The class a record should have carried, decided from what was stored rather than from the event
 * text.
 *
 * `classifyFailure` runs while a task is still in memory and reaches its provider verdict by
 * looking for the word "provider" in the error text. NVIDIA says "NVIDIA API Error: 504", which
 * contains no such word, so a task the provider killed mid-refactor was filed as an unexplained
 * grader failure. A repair budget exhausted at "REPAIR_TIMEOUT" landed in the same place. Three of
 * the first four failures in B0 were filed there, which makes the class distribution useless
 * exactly where it is supposed to be informative.
 *
 * This runs at report time instead of at record time on purpose. A run takes hours, so the
 * classifier cannot be corrected mid-flight without leaving one journal holding records sorted by
 * two different rules. The stored class stays in the journal for audit; the report uses this.
 */
export function refineFailureClass(record: RunRecord): FailureClass | null {
  if (record.grader.correct) return null;

  const failures = record.providerFailures;
  const error = record.comuError ?? "";

  // The provider ended the task. Whatever the agent had done by then is not what is being measured.
  if (record.comuStatus === "failed" && failures) {
    if (failures.gateway > 0 || failures.rateLimits > 0 || failures.other > 0) return "provider_error";
    // A timeout is the one cause the benchmark can create for itself under concurrency, so it is
    // named as a provider error rather than blamed on the agent.
    if (failures.timeouts > 0) return "provider_error";
  }

  // A budget ran out. The agent did not fail at the work; it was not allowed to continue.
  if (/REPAIR_TIMEOUT|REPAIR_LIMIT_REACHED|VALIDATION_LIMIT_REACHED|LIMIT_REACHED/.test(error)) {
    return "loop_truncation";
  }

  // Filed as touching files outside the golden set, when every one of them was compiled output.
  if (record.failureClass === "unnecessary_changes" && agentAuthored(record.unnecessaryChanges).length === 0) {
    return record.comuStatus === "completed" ? "planning_miss" : "grader_failed_other";
  }

  return record.failureClass;
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
  concurrency: number;
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
    concurrency: input.concurrency,
    comuStatus: outcome.status,
    comuError: (outcome.terminalError ?? "").slice(0, MAX_ANSWER_CHARS),
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
    providerFailures: outcome.providerFailures,
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
  /** Totals, because a cost is a rate applied to these and the rate is not COMU's to invent. */
  totalPromptTokens: number;
  totalCompletionTokens: number;
  providerFailures: ProviderFailureCounts;
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
  perFixture: Array<{
    fixtureId: string;
    tier: string;
    correct: number;
    of: number;
    /**
     * Largest prompt this fixture produced, as a share of the model's window.
     *
     * Per fixture rather than only in aggregate, because it is the number that predicts where the
     * context ceiling bites: an aggregate maximum tells you one task got close and not which.
     */
    peakContextRatio: number;
    providerFailures: ProviderFailureCounts;
  }>;
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
    const cls = refineFailureClass(record);
    if (cls) failureCounts[cls] = (failureCounts[cls] ?? 0) + 1;
  }

  const byFixture = new Map<string, { tier: string; correct: number; of: number; peakContextRatio: number; providerFailures: ProviderFailureCounts }>();
  for (const record of records) {
    const entry = byFixture.get(record.fixtureId) ?? { tier: record.tier, correct: 0, of: 0, peakContextRatio: 0, providerFailures: { timeouts: 0, rateLimits: 0, gateway: 0, other: 0 } };
    entry.of += 1;
    if (record.grader.correct) entry.correct += 1;
    entry.peakContextRatio = Math.max(entry.peakContextRatio, record.peakContextRatio);
    for (const k of FAILURE_KEYS) entry.providerFailures[k] += record.providerFailures?.[k] ?? 0;
    byFixture.set(record.fixtureId, entry);
  }

  const perFixture = [...byFixture.entries()]
    .map(([fixtureId, v]) => ({
      fixtureId,
      tier: v.tier,
      correct: v.correct,
      of: v.of,
      peakContextRatio: v.peakContextRatio,
      providerFailures: v.providerFailures
    }))
    .sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));

  return {
    runs: records.length,
    correct: correct.length,
    falseCompletions: records.filter(r => r.falseCompletion).length,
    falseFailures: records.filter(r => r.falseFailure).length,
    totalPromptTokens: records.reduce((sum, r) => sum + r.promptTokens, 0),
    totalCompletionTokens: records.reduce((sum, r) => sum + r.completionTokens, 0),
    providerFailures: records.reduce(
      (acc, r) => {
        for (const k of FAILURE_KEYS) acc[k] += r.providerFailures?.[k] ?? 0;
        return acc;
      },
      { timeouts: 0, rateLimits: 0, gateway: 0, other: 0 } as ProviderFailureCounts
    ),
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
