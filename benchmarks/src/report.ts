import fs from "node:fs";
import path from "node:path";
import {
  TIER_NAMES,
  providerKill,
  type BenchmarkRun,
  type GatewayCheck,
  type JournalMarker,
  type MixedLimitsMarker,
  type RunAnnotations,
  type RunRecord,
  type Tier
} from "./types.js";
import { describeLimitDifferences } from "./resume.js";
import { summarise } from "./metrics.js";
import { assertNoSecret } from "./secrets.js";

/**
 * Writing a run down.
 *
 * The JSON is the record and is what later runs are compared against. The markdown exists so a
 * reader can see the shape of a result without parsing anything, and it deliberately reports
 * per-fixture success out of repetitions rather than a single rate: an agent that succeeds three
 * times in five is a different product from one that succeeds five in five, and a mean hides that.
 */

/**
 * Appends one finished run to a journal beside the results.
 *
 * A full benchmark takes hours. Writing only at the end means a crash, a dropped connection or a
 * closed laptop lid throws away everything measured so far, and the provider time with it. Each
 * record is written the moment it exists, and a later run can pick up where this one stopped.
 */
export function appendRecord(record: RunRecord, outDir: string, label: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  const line = `${JSON.stringify(record)}\n`;
  assertNoSecret(line, `the run journal for ${label}`);
  fs.appendFileSync(path.join(outDir, `${journalStem(label)}.jsonl`), line, "utf8");
}

/** Records already measured for this label, so a resumed run does not pay for them twice. */
export function readJournal(outDir: string, label: string): RunRecord[] {
  return readJournalLines(outDir, label).filter((entry): entry is RunRecord => !isMarker(entry));
}

/** Every time a resume was allowed to change the budget under this label. */
export function readJournalMarkers(outDir: string, label: string): MixedLimitsMarker[] {
  return readJournalEvents(outDir, label, "mixed_limits");
}

/** Every marker of one kind written into this label's journal, oldest first. */
export function readJournalEvents<K extends JournalMarker["journalEvent"]>(
  outDir: string,
  label: string,
  kind: K
): Array<Extract<JournalMarker, { journalEvent: K }>> {
  return readJournalLines(outDir, label).filter(
    (entry): entry is Extract<JournalMarker, { journalEvent: K }> => isMarker(entry) && entry.journalEvent === kind
  );
}

/** Marks the journal as mixed before any record is measured under the new budget. */
export function appendMixedLimitsMarker(marker: MixedLimitsMarker, outDir: string, label: string): void {
  appendMarker(marker, outDir, label);
}

/** Writes a marker into the journal. Checked for the credential like a record: a probe's error text is the provider's. */
export function appendMarker(marker: JournalMarker, outDir: string, label: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  const line = `${JSON.stringify(marker)}\n`;
  assertNoSecret(line, `the run journal for ${label}`);
  fs.appendFileSync(path.join(outDir, `${journalStem(label)}.jsonl`), line, "utf8");
}

/** The run's annotations, when a correction or caveat has been recorded beside its journal. */
export function readAnnotations(outDir: string, label: string): RunAnnotations | undefined {
  const file = path.join(outDir, `${label}.annotations.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as RunAnnotations) : undefined;
}

/**
 * Applies a run's annotations to what is rendered, never to the journal.
 *
 * A served-model correction replaces the model everywhere the result names it, on the run and on
 * every record, so no part of the result contradicts the rest. The name it was launched under is
 * kept on the annotation and stated in the report.
 */
export function annotate(run: BenchmarkRun, annotations: RunAnnotations | undefined): BenchmarkRun {
  if (!annotations) return run;
  const served = annotations.servedModel;
  if (!served) return { ...run, annotations };
  const model = { id: served.id, provider: served.provider };
  return { ...run, annotations, model, records: run.records.map(r => ({ ...r, model })) };
}

function readJournalLines(outDir: string, label: string): Array<RunRecord | JournalMarker> {
  const file = path.join(outDir, `${journalStem(label)}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as RunRecord | JournalMarker);
}

/** Any line with a journalEvent is a marker, never a record, whichever kind it is. */
function isMarker(entry: RunRecord | JournalMarker): entry is JournalMarker {
  return typeof (entry as JournalMarker).journalEvent === "string";
}

/**
 * The journal is keyed by label alone, with no date.
 *
 * A run takes hours and can cross midnight. Dating the journal would split it in two at that
 * moment, and a resume would then re-measure everything recorded before the split and pay for it
 * twice.
 */
function journalStem(label: string): string {
  return `${label}.journal`;
}

/**
 * Refuses to start a second run under the same label.
 *
 * Three runners were once alive at once against one journal, each believing it had the label to
 * itself. They tripled the load on the provider, duplicated work, and would each have written the
 * final result file from its own partial set of records. None of that is visible in the output: the
 * journal looked healthy, the runs were merely slow.
 *
 * The lock holds the pid, so a lock left behind by a killed process is detected rather than
 * requiring a manual delete. The only state trusted here is whether that pid is alive.
 */
export function acquireRunLock(outDir: string, label: string): () => void {
  fs.mkdirSync(outDir, { recursive: true });
  const file = lockFile(outDir, label);

  if (fs.existsSync(file)) {
    const holder = readRunLock(outDir, label)?.pid;
    if (holder !== undefined && isAlive(holder)) {
      throw new Error(
        `Another run of '${label}' is already going (pid ${holder}). Two runners share one journal, ` +
          "triple the provider load and each write the result file from their own partial records. " +
          `Stop that process, or use a different --label. If you are sure it is gone, delete ${file}.`
      );
    }
    // Stale: the holder is not running. A killed run must not need a manual cleanup step.
    fs.rmSync(file, { force: true });
  }

  const state: RunLockState = { pid: process.pid, startedAt: new Date().toISOString(), planned: [], inFlight: [], finished: [] };
  fs.writeFileSync(file, JSON.stringify(state), "utf8");
  return () => {
    // Only ever our own lock: a release that runs after another runner took over must not remove theirs.
    if (readRunLock(outDir, label)?.pid === process.pid) fs.rmSync(file, { force: true });
  };
}

/**
 * What a live run is doing, kept in its lock so another shell can ask.
 *
 * The run has outlived the shell that started it (it is launched detached), so its console is not
 * something anyone is watching. `bench --status` reads this and the journal instead.
 */
export interface RunLockState {
  pid: number;
  startedAt: string;
  /** Cells this launch set out to measure, by cellKey. */
  planned: string[];
  /** Cells started and not yet finished. */
  inFlight: Array<{ cell: string; startedAt: string }>;
  /** Cells this launch finished, whatever their outcome, including a harness error. */
  finished: string[];
}

function lockFile(outDir: string, label: string): string {
  return path.join(outDir, `${label}.lock`);
}

/**
 * The lock's contents. A lock written before it carried state holds a bare pid, which still reads.
 * Undefined when there is no lock or it cannot be read.
 */
export function readRunLock(outDir: string, label: string): RunLockState | undefined {
  const file = lockFile(outDir, label);
  if (!fs.existsSync(file)) return undefined;
  const text = fs.readFileSync(file, "utf8").trim();
  if (/^\d+$/.test(text)) return { pid: Number(text), startedAt: "", planned: [], inFlight: [], finished: [] };
  try {
    const state = JSON.parse(text) as RunLockState;
    return Number.isInteger(state.pid) && state.pid > 0 ? state : undefined;
  } catch {
    return undefined;
  }
}

/** Rewrites this process's lock with its progress. Never touches a lock another process holds. */
export function updateRunLock(outDir: string, label: string, change: (state: RunLockState) => void): void {
  const state = readRunLock(outDir, label);
  if (!state || state.pid !== process.pid) return;
  change(state);
  fs.writeFileSync(lockFile(outDir, label), JSON.stringify(state), "utf8");
}

/** Whether a pid is running. Signal 0 checks for existence without delivering anything. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to someone else, which still counts as alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * One record per cell, keeping the most recent.
 *
 * The journal is append-only, so re-measuring a fixture and repetition leaves both records in it.
 * That is deliberate — the earlier one is the audit trail for why the cell was re-run — but a
 * summary must count each cell once, and the later measurement is the one that supersedes.
 */
export function latestPerCell(records: RunRecord[]): RunRecord[] {
  const byCell = new Map<string, RunRecord>();
  for (const record of records) byCell.set(`${record.fixtureId}#${record.rep}`, record);
  return [...byCell.values()];
}

/** Whether the provider, rather than the agent, ended this run, including by dropping the connection. */
export function killedByProvider(record: RunRecord): boolean {
  return providerKill(record) !== null;
}

export function writeRun(run: BenchmarkRun, outDir: string): { jsonPath: string; markdownPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const stem = `${run.startedAt.slice(0, 10)}-${run.label}`;
  const jsonPath = path.join(outDir, `${stem}.json`);
  const markdownPath = path.join(outDir, `${stem}.md`);

  const json = `${JSON.stringify(run, null, 2)}\n`;
  const markdown = renderMarkdown(run);

  // Checked before either file exists. A result is meant to be committed, and a credential in git
  // history is permanent.
  assertNoSecret(json, `the result file ${path.basename(jsonPath)}`);
  assertNoSecret(markdown, `the summary ${path.basename(markdownPath)}`);

  fs.writeFileSync(jsonPath, json, "utf8");
  fs.writeFileSync(markdownPath, markdown, "utf8");
  return { jsonPath, markdownPath };
}

/**
 * Timeouts, rate limits, gateway, other.
 *
 * Kept as four numbers rather than a total because only some of them are COMU's: a timeout under
 * concurrency is the measurement's own contention arriving as a failed task.
 */
function fmtFailures(f: { timeouts: number; rateLimits: number; gateway: number; other: number } | undefined): string {
  if (!f) return "not recorded";
  return `${f.timeouts}/${f.rateLimits}/${f.gateway}/${f.other}`;
}

/**
 * Thousands separators that do not depend on where the machine is.
 *
 * `toLocaleString()` with no locale follows the host, which rendered 174,779 as "1,74,779" on the
 * machine this was run on. A committed result is compared against later runs and read by people
 * elsewhere, so its numbers cannot change shape with the reader.
 */
function fmtCount(value: number): string {
  return value.toLocaleString("en-US");
}

function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** A gateway check in two lines: what the probes measured, and what they were held to. */
export function describeGatewayCheck(check: GatewayCheck): string[] {
  const probes = check.probes.map(p => (p.latencyMs === null ? `failed (${p.error ?? "no answer"})` : fmtSeconds(p.latencyMs)));
  const measure = check.baseline.measure === "request_latency" ? "model request latency" : "wall clock per successful request";
  const median = check.medianMs === null ? `over the ${fmtSeconds(check.thresholdMs)} cap` : fmtSeconds(check.medianMs);
  return [
    `Probes: ${probes.join(", ")}. Median ${median}: ${check.slow ? "too slow" : "within the threshold"}.`,
    `Threshold ${fmtSeconds(check.thresholdMs)}: ${check.multiple}x ${check.baseline.label}'s median ${measure} of ${fmtSeconds(check.baseline.medianMs)}, over ${check.baseline.cells} cells (${check.baseline.source}).`
  ];
}

function fmtOptionalSeconds(ms: number | null): string {
  return ms === null ? "-" : fmtSeconds(ms);
}

function fmtSpreadSeconds(s: { median: number; min: number; max: number }): string {
  return `${fmtSeconds(s.median)} (${fmtSeconds(s.min)} to ${fmtSeconds(s.max)})`;
}

export function renderMarkdown(run: BenchmarkRun): string {
  const summary = summarise(run.records);
  const lines: string[] = [];

  lines.push(`# Benchmark run: ${run.label}`);
  lines.push("");
  lines.push(`Model \`${run.model.id}\` via ${run.model.provider}. Commit \`${run.gitCommit}\`.`);
  const killed = summary.providerKilled.length;
  lines.push(
    `${run.reps} repetitions per fixture, ${summary.runs} runs measured, started ${run.startedAt}.` +
      (killed > 0 ? ` ${killed} more ${killed === 1 ? "was" : "were"} ended by the provider and ${killed === 1 ? "is" : "are"} not counted anywhere below; see "Not measured".` : "")
  );
  const served = run.annotations?.servedModel;
  if (served) {
    lines.push("");
    lines.push(`**Model correction.** This run was launched naming \`${served.launchedAs}\`. ${served.reason}`);
  }
  const limitations = run.annotations?.limitations ?? [];
  if (limitations.length > 0) {
    lines.push("");
    lines.push("**Limitations.**");
    lines.push("");
    for (const limitation of limitations) lines.push(`- ${limitation}`);
  }
  if (run.mixedLimits && run.mixedLimits.length > 0) {
    lines.push("");
    lines.push(
      "**Mixed budget.** This run was resumed under different limits from records already in its " +
        "journal, so its records were not all measured under one budget:"
    );
    lines.push("");
    for (const marker of run.mixedLimits) {
      lines.push(`- Accepted ${marker.acceptedAt}:`);
      for (const line of describeLimitDifferences(marker.differences)) lines.push(`  - ${line.trim()}`);
    }
  }
  if (run.slowGateway && run.slowGateway.length > 0) {
    lines.push("");
    lines.push(
      "**Slow gateway.** This run was launched into a provider slower than the launch gate allows, under " +
        "--accept-slow-gateway. Its wall clock, and any budget measured in time, are not comparable with the baseline:"
    );
    lines.push("");
    for (const marker of run.slowGateway) {
      lines.push(`- Accepted ${marker.acceptedAt}:`);
      for (const line of describeGatewayCheck(marker.check)) lines.push(`  - ${line}`);
    }
  }
  if (run.gatewayProbes && run.gatewayProbes.length > 0) {
    lines.push("");
    lines.push("**Provider at launch.** Probed before each launch under this label:");
    lines.push("");
    for (const marker of run.gatewayProbes) {
      lines.push(`- ${marker.probedAt}:`);
      for (const line of describeGatewayCheck(marker.check)) lines.push(`  - ${line}`);
    }
  }
  if (run.concurrency > 1) {
    lines.push("");
    lines.push(
      `Run with concurrency ${run.concurrency}, so the wall clock below is an upper bound: concurrent ` +
        "runs contend for the provider. Correctness, tokens, peak context and failure classes are " +
        "unaffected, because every run has its own runtime and its own workspace."
    );
  }
  lines.push("");

  // Per fixture first, and no pooled rate anywhere. Averaging a fixture that always works with one
  // that never does reports something true of neither.
  lines.push("## Per fixture");
  lines.push("");
  // The last two columns describe the provider the cell ran against, so the run's own conditions
  // sit beside its results. "-" is a cell that recorded no latency: written before it was measured.
  lines.push(
    "| Fixture | Tier | Correct | False failures | False completions | Unverified completions | Peak prompt, share of window | Provider failures (t/r/g/o) | Request latency, median | Wall clock per request |"
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const entry of summary.perFixture) {
    const tier = TIER_NAMES[entry.tier as Tier] ?? entry.tier;
    // A fixture whose every cell the provider ended has no result, which is not the same as 0 of 0.
    const correct = entry.of > 0 ? `${entry.correct} of ${entry.of}` : "not measured";
    const killedNote = entry.providerKilled > 0 ? ` (+${entry.providerKilled} killed by provider)` : "";
    lines.push(
      `| ${entry.fixtureId} | ${entry.tier} ${tier} | ${correct}${killedNote} | ${entry.falseFailures} | ${entry.falseCompletions} | ${entry.unverifiedCompletions} | ${(entry.peakContextRatio * 100).toFixed(1)}% | ${fmtFailures(entry.providerFailures)} | ${fmtOptionalSeconds(entry.requestLatencyMs)} | ${fmtOptionalSeconds(entry.wallClockPerRequestMs)} |`
    );
  }
  lines.push("");
  lines.push(
    `Always correct: ${summary.reliability.always}. Sometimes: ${summary.reliability.sometimes}. Never: ${summary.reliability.never}.`
  );
  lines.push("");

  lines.push("## Agreement and cost");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| False completions | ${summary.falseCompletions} |`);
  lines.push(`| False failures | ${summary.falseFailures} |`);
  lines.push(`| Unverified completions (COMU said NOT_VERIFIED) | ${summary.unverifiedCompletions} |`);
  // With nothing measured there is no spread to show, and zeros would read as a measurement.
  const none = "no run measured";
  lines.push(
    `| Wall clock, median (range) | ${summary.runs === 0 ? none : `${fmtSeconds(summary.durationMs.median)} (${fmtSeconds(summary.durationMs.min)} to ${fmtSeconds(summary.durationMs.max)})`} |`
  );
  lines.push(
    `| Prompt tokens per run, median (range) | ${summary.runs === 0 ? none : `${fmtCount(summary.promptTokens.median)} (${fmtCount(summary.promptTokens.min)} to ${fmtCount(summary.promptTokens.max)})`} |`
  );
  // Named, not just measured. "10.3% of the window" prompts no action; "t2-ts-endpoint reached
  // 10.3%" says which fixture to look at first when context budgeting lands.
  const worst = summary.perFixture.filter(f => f.of > 0).sort((a, b) => b.peakContextRatio - a.peakContextRatio)[0];
  lines.push(
    `| Largest prompt seen, as a share of the window | ${worst ? `${(summary.maxPeakContextRatio * 100).toFixed(1)}%, by ${worst.fixtureId}` : none} |`
  );
  // Across every cell, killed ones included: this is the provider the run was measured against.
  lines.push(
    `| Model request latency, per-cell median (range across cells) | ${summary.requestLatencyMs ? fmtSpreadSeconds(summary.requestLatencyMs) : "not recorded"} |`
  );
  lines.push(
    `| Wall clock per successful request, per cell (range across cells) | ${summary.wallClockPerRequestMs.max > 0 ? fmtSpreadSeconds(summary.wallClockPerRequestMs) : "no request succeeded"} |`
  );
  lines.push(`| Total prompt tokens | ${fmtCount(summary.totalPromptTokens)} |`);
  lines.push(`| Total completion tokens | ${fmtCount(summary.totalCompletionTokens)} |`);
  lines.push(
    "| Cost | No price is configured for this model, so the runtime reports none. The token totals above are what a price would be applied to. |"
  );
  const pf = summary.providerFailures;
  lines.push(`| Provider timeouts | ${pf.timeouts} |`);
  lines.push(`| Provider rate limits (429) | ${pf.rateLimits} |`);
  lines.push(`| Gateway refusals (502, 503, 504) | ${pf.gateway} |`);
  lines.push(`| Other provider errors | ${pf.other} |`);
  lines.push("");

  /*
   * A false failure is only actionable with its cause attached.
   *
   * The count alone says the agent disagreed with the workspace; it does not say whether that was a
   * budget the harness set too low, a provider timeout the concurrency caused, or a gate misfiring
   * on work that was already done. Each of those is a different defect and only one of them is
   * COMU's.
   */
  const falseFailures = run.records.filter(r => r.falseFailure && !providerKill(r));
  if (falseFailures.length > 0) {
    lines.push("## False failures, with causes");
    lines.push("");
    lines.push("The work was correct and COMU said otherwise.");
    lines.push("");
    lines.push("| Fixture | Rep | COMU said | Provider failures (t/r/g/o) |");
    lines.push("|---|---|---|---|");
    for (const r of falseFailures) {
      const said = (r.comuError || r.comuStatus || "").replace(/\s+/g, " ").slice(0, 160) || "nothing recorded";
      lines.push(`| ${r.fixtureId} | ${r.rep} | ${said} | ${fmtFailures(r.providerFailures)} |`);
    }
    lines.push("");
  }

  /*
   * Cells the provider ended.
   *
   * Listed, not scored. The model never answered, so the grader had nothing of the agent's to
   * grade; counting these as failures reported a gateway outage as a regression. The cause is the
   * provider failure counter that moved, never the error text.
   */
  if (summary.providerKilled.length > 0) {
    lines.push("## Not measured: ended by the provider");
    lines.push("");
    lines.push("Excluded from correctness, k of n, false completions and failures, and failure classes.");
    lines.push("");
    lines.push("| Fixture | Rep | Cause | Provider said |");
    lines.push("|---|---|---|---|");
    for (const cell of summary.providerKilled) {
      const said = cell.comuError.replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 160) || "nothing recorded";
      lines.push(`| ${cell.fixtureId} | ${cell.rep} | ${cell.cause} | ${said} |`);
    }
    lines.push("");
  }

  lines.push("## Failure classes");
  lines.push("");
  if (Object.keys(summary.failureCounts).length === 0) {
    lines.push("No failures.");
  } else {
    lines.push("| Class | Runs |");
    lines.push("|---|---|");
    for (const [cls, count] of Object.entries(summary.failureCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${cls.replace(/_/g, " ")} | ${count} |`);
    }
  }
  lines.push("");

  lines.push("## Reading a delta against this run");
  lines.push("");
  lines.push("A change smaller than the run to run spread is no detected change. Specifically:");
  lines.push("");
  lines.push(`- A fixture moving by one repetition out of ${run.reps} is noise, not a result.`);
  lines.push("- A fixture moving by two or more is a signal for that fixture.");
  lines.push("- A suite level claim needs two or more fixtures moving by two or more in the same direction.");
  lines.push("- A continuous metric has moved only when the two runs' ranges do not overlap.");
  lines.push("- A failure class has moved only when its count changes by more than the number of fixtures that moved.");
  lines.push("");

  const harnessErrors = run.records.filter(r => r.harnessError);
  if (harnessErrors.length > 0) {
    lines.push("## Harness errors");
    lines.push("");
    lines.push("These are the instrument failing, not the agent.");
    lines.push("");
    for (const record of harnessErrors) {
      lines.push(`- ${record.fixtureId} rep ${record.rep}: ${record.harnessError}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
