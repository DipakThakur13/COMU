import type { AgentEvent } from "@comu/protocol";
import {
  providerKill,
  type FailureClass,
  type GraderVerdict,
  type ProviderFailureCounts,
  type ProviderKillCause,
  type RequestLatency,
  type RunRecord
} from "./types.js";

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
 *
 * The one exception to "the grader decides" is a provider kill, which is checked before the verdict
 * and from the counters rather than the text. When the model never answered, the grader had nothing
 * of the agent's to grade, whichever way it came out.
 */
export function classifyFailure({ outcome, verdict, unnecessary, peakContextRatio }: ClassifyInput): FailureClass | null {
  if (providerKill({ comuStatus: outcome.status, providerFailures: outcome.providerFailures, harnessError: outcome.harnessError })) {
    return "provider_error";
  }
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
 * Records written before `classifyFailure` read the counters were classified by looking for the
 * word "provider" in the error text. NVIDIA says "NVIDIA API Error: 504", which contains no such
 * word, so a task the provider killed mid-refactor was filed as an unexplained grader failure. A
 * repair budget exhausted at "REPAIR_TIMEOUT" landed in the same place. Three of the first four
 * failures in B0 were filed there, and both of B1's first two records.
 *
 * This runs at report time instead of at record time on purpose. A run takes hours, so the
 * classifier cannot be corrected mid-flight without leaving one journal holding records sorted by
 * two different rules. The stored class stays in the journal for audit; the report uses this.
 */
export function refineFailureClass(record: RunRecord): FailureClass | null {
  // Ahead of the verdict: the provider ended the task, so whatever the grader found is not the agent's.
  if (providerKill(record)) return "provider_error";
  if (record.grader.correct) return null;

  const error = record.comuError ?? "";

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

/**
 * A run COMU completed while stating that nothing verified the change.
 *
 * Counted beside false completions, not instead of them: an unverified completion of wrong work is
 * still a false completion. This says how often COMU finishes without evidence, which is what the
 * NOT_VERIFIED outcome exists to make visible.
 */
export function unverifiedCompletion(record: Pick<RunRecord, "comuStatus" | "verificationStatus">): boolean {
  return record.comuStatus === "completed" && record.verificationStatus === "NOT_VERIFIED";
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

function latencyOf(latencies: number[]): RequestLatency {
  const s = spread(latencies.map(Math.round));
  return { medianMs: s.median, minMs: s.min, maxMs: s.max, count: latencies.length };
}

export function assembleRecord(input: AssembleInput): RunRecord {
  const { outcome, verdict } = input;
  const peakContextRatio = input.contextWindow > 0 ? outcome.peakPromptTokens / input.contextWindow : 0;

  // The two directions of disagreement between COMU and reality. Named separately because they
  // have different causes and different costs: one destroys trust, the other wastes work. A run the
  // provider ended is neither: COMU did not say the work had failed, the provider stopped it.
  const killed = providerKill({ comuStatus: outcome.status, providerFailures: outcome.providerFailures, harnessError: outcome.harnessError });
  const falseCompletion = outcome.status === "completed" && !verdict.correct;
  const falseFailure = outcome.status !== "completed" && verdict.correct && !killed;

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
    ...(outcome.requestLatenciesMs.length > 0 ? { requestLatency: latencyOf(outcome.requestLatenciesMs) } : {}),
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

/** A cell the provider ended. Not a measurement of COMU, so it is listed rather than scored. */
export interface ProviderKilledCell {
  fixtureId: string;
  rep: number;
  cause: ProviderKillCause;
  comuError: string;
}

export interface Summary {
  /** Cells that measured COMU: every record except those the provider killed. */
  runs: number;
  /** Cells the provider ended, excluded from every count of COMU's work and from k of n. */
  providerKilled: ProviderKilledCell[];
  correct: number;
  falseCompletions: number;
  falseFailures: number;
  /** Completions COMU itself marked NOT_VERIFIED. */
  unverifiedCompletions: number;
  /** Totals, because a cost is a rate applied to these and the rate is not COMU's to invent. */
  totalPromptTokens: number;
  totalCompletionTokens: number;
  providerFailures: ProviderFailureCounts;
  durationMs: Spread;
  promptTokens: Spread;
  /**
   * Per-cell median model request latency, across cells, including cells the provider killed: it
   * describes the provider the run was measured against, which is what makes two runs comparable
   * or not. Null when no record carries it (every record written before it was measured).
   */
  requestLatencyMs: Spread | null;
  /**
   * Wall clock per successful model request, across cells. Cruder than the latency, since it
   * includes tool and test time, but every record back to B0 carries what it is computed from.
   */
  wallClockPerRequestMs: Spread;
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
    /** Runs COMU reported as failed that the grader found correct. */
    falseFailures: number;
    /** Runs COMU reported as completed that the grader found incorrect. */
    falseCompletions: number;
    /** Runs COMU completed while saying nothing verified the change (NOT_VERIFIED). */
    unverifiedCompletions: number;
    /** Runs the provider ended, not counted in `of`. */
    providerKilled: number;
    /** Median of this fixture's per-cell median request latency; null when never measured. */
    requestLatencyMs: number | null;
    /** Median of this fixture's wall clock per successful model request; null with no request. */
    wallClockPerRequestMs: number | null;
  }>;
  /** Fixtures that always, sometimes and never produced correct work. A fixture with no measured cell is none of these. */
  reliability: { always: number; sometimes: number; never: number };
}

/**
 * Wall clock per successful model request: how B0's "71 seconds per request" was computed.
 *
 * Kept because every record back to B0 carries its inputs, so it is the one latency measure that
 * compares across the whole history. It overstates the provider's share, since tool and test time
 * are in the numerator. Undefined for a cell with no successful request.
 */
export function wallClockPerRequestMs(record: Pick<RunRecord, "durationMs" | "modelRequests">): number | undefined {
  return record.modelRequests > 0 ? record.durationMs / record.modelRequests : undefined;
}

function spread(values: number[]): Spread {
  if (values.length === 0) return { median: 0, min: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
  return { median, min: sorted[0], max: sorted[sorted.length - 1] };
}

/**
 * A run's records, reduced to what it says about COMU.
 *
 * A cell the provider killed is set aside before anything is counted: not correct, not failed, not
 * in k of n, not in any failure class. It is listed instead, with its cause, so a gateway outage
 * reads as missing measurements rather than as a regression. Token totals and provider failure
 * counts still include it, because those describe what was spent and what the provider did.
 */
export function summarise(records: RunRecord[]): Summary {
  const providerKilled: ProviderKilledCell[] = [];
  const measured: RunRecord[] = [];
  for (const record of records) {
    const cause = providerKill(record);
    if (cause) providerKilled.push({ fixtureId: record.fixtureId, rep: record.rep, cause, comuError: record.comuError ?? "" });
    else measured.push(record);
  }

  const failureCounts: Record<string, number> = {};
  for (const record of measured) {
    const cls = refineFailureClass(record);
    if (cls) failureCounts[cls] = (failureCounts[cls] ?? 0) + 1;
  }

  const byFixture = new Map<
    string,
    {
      tier: string;
      correct: number;
      of: number;
      peakContextRatio: number;
      providerFailures: ProviderFailureCounts;
      falseFailures: number;
      falseCompletions: number;
      unverifiedCompletions: number;
      providerKilled: number;
      latencies: number[];
      wallPerRequest: number[];
    }
  >();
  for (const record of records) {
    const entry = byFixture.get(record.fixtureId) ?? {
      tier: record.tier,
      correct: 0,
      of: 0,
      peakContextRatio: 0,
      providerFailures: { timeouts: 0, rateLimits: 0, gateway: 0, other: 0 },
      falseFailures: 0,
      falseCompletions: 0,
      unverifiedCompletions: 0,
      providerKilled: 0,
      latencies: [],
      wallPerRequest: []
    };
    // What the provider did, and how fast, is counted for every cell.
    for (const k of FAILURE_KEYS) entry.providerFailures[k] += record.providerFailures?.[k] ?? 0;
    if (record.requestLatency) entry.latencies.push(record.requestLatency.medianMs);
    const perRequest = wallClockPerRequestMs(record);
    if (perRequest !== undefined) entry.wallPerRequest.push(perRequest);

    // What COMU did is counted only for cells that measured it.
    if (providerKill(record)) {
      entry.providerKilled += 1;
    } else {
      entry.of += 1;
      if (unverifiedCompletion(record)) entry.unverifiedCompletions += 1;
      if (record.falseFailure) entry.falseFailures += 1;
      if (record.falseCompletion) entry.falseCompletions += 1;
      if (record.grader.correct) entry.correct += 1;
      entry.peakContextRatio = Math.max(entry.peakContextRatio, record.peakContextRatio);
    }
    byFixture.set(record.fixtureId, entry);
  }

  const perFixture = [...byFixture.entries()]
    .map(([fixtureId, v]) => ({
      fixtureId,
      tier: v.tier,
      correct: v.correct,
      of: v.of,
      peakContextRatio: v.peakContextRatio,
      providerFailures: v.providerFailures,
      falseFailures: v.falseFailures,
      falseCompletions: v.falseCompletions,
      unverifiedCompletions: v.unverifiedCompletions,
      providerKilled: v.providerKilled,
      requestLatencyMs: v.latencies.length > 0 ? spread(v.latencies).median : null,
      wallClockPerRequestMs: v.wallPerRequest.length > 0 ? spread(v.wallPerRequest).median : null
    }))
    .sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));

  const scored = perFixture.filter(f => f.of > 0);
  const latencies = records.flatMap(r => (r.requestLatency ? [r.requestLatency.medianMs] : []));

  return {
    runs: measured.length,
    providerKilled,
    correct: measured.filter(r => r.grader.correct).length,
    falseCompletions: measured.filter(r => r.falseCompletion).length,
    unverifiedCompletions: measured.filter(unverifiedCompletion).length,
    falseFailures: measured.filter(r => r.falseFailure).length,
    totalPromptTokens: records.reduce((sum, r) => sum + r.promptTokens, 0),
    totalCompletionTokens: records.reduce((sum, r) => sum + r.completionTokens, 0),
    providerFailures: records.reduce(
      (acc, r) => {
        for (const k of FAILURE_KEYS) acc[k] += r.providerFailures?.[k] ?? 0;
        return acc;
      },
      { timeouts: 0, rateLimits: 0, gateway: 0, other: 0 } as ProviderFailureCounts
    ),
    durationMs: spread(measured.map(r => r.durationMs)),
    promptTokens: spread(measured.map(r => r.promptTokens)),
    requestLatencyMs: latencies.length > 0 ? spread(latencies) : null,
    wallClockPerRequestMs: spread(records.flatMap(r => wallClockPerRequestMs(r) ?? [])),
    maxPeakContextRatio: measured.reduce((max, r) => Math.max(max, r.peakContextRatio), 0),
    failureCounts,
    perFixture,
    reliability: {
      always: scored.filter(f => f.correct === f.of).length,
      sometimes: scored.filter(f => f.correct > 0 && f.correct < f.of).length,
      never: scored.filter(f => f.correct === 0).length
    }
  };
}
