import fs from "node:fs";
import path from "node:path";
import { TIER_NAMES, type BenchmarkRun, type RunRecord, type Tier } from "./types.js";
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
  const file = path.join(outDir, `${journalStem(label)}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as RunRecord);
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
  const file = path.join(outDir, `${label}.lock`);

  if (fs.existsSync(file)) {
    const holder = Number(fs.readFileSync(file, "utf8").trim());
    if (Number.isInteger(holder) && holder > 0 && isAlive(holder)) {
      throw new Error(
        `Another run of '${label}' is already going (pid ${holder}). Two runners share one journal, ` +
          "triple the provider load and each write the result file from their own partial records. " +
          `Stop that process, or use a different --label. If you are sure it is gone, delete ${file}.`
      );
    }
    // Stale: the holder is not running. A killed run must not need a manual cleanup step.
    fs.rmSync(file, { force: true });
  }

  fs.writeFileSync(file, String(process.pid), "utf8");
  return () => fs.rmSync(file, { force: true });
}

/** Whether a pid is running. Signal 0 checks for existence without delivering anything. */
function isAlive(pid: number): boolean {
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

/** Whether the provider, rather than the agent, ended this run. */
export function killedByProvider(record: RunRecord): boolean {
  const f = record.providerFailures;
  if (!f) return false;
  return record.comuStatus !== "completed" && f.timeouts + f.rateLimits + f.gateway + f.other > 0;
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

export function renderMarkdown(run: BenchmarkRun): string {
  const summary = summarise(run.records);
  const lines: string[] = [];

  lines.push(`# Benchmark run: ${run.label}`);
  lines.push("");
  lines.push(`Model \`${run.model.id}\` via ${run.model.provider}. Commit \`${run.gitCommit}\`.`);
  lines.push(`${run.reps} repetitions per fixture, ${summary.runs} runs, started ${run.startedAt}.`);
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
  lines.push("| Fixture | Tier | Correct | Peak prompt, share of window | Provider failures (t/r/g/o) |");
  lines.push("|---|---|---|---|---|");
  for (const entry of summary.perFixture) {
    const tier = TIER_NAMES[entry.tier as Tier] ?? entry.tier;
    lines.push(
      `| ${entry.fixtureId} | ${entry.tier} ${tier} | ${entry.correct} of ${entry.of} | ${(entry.peakContextRatio * 100).toFixed(1)}% | ${fmtFailures(entry.providerFailures)} |`
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
  lines.push(
    `| Wall clock, median (range) | ${fmtSeconds(summary.durationMs.median)} (${fmtSeconds(summary.durationMs.min)} to ${fmtSeconds(summary.durationMs.max)}) |`
  );
  lines.push(
    `| Prompt tokens per run, median (range) | ${fmtCount(summary.promptTokens.median)} (${fmtCount(summary.promptTokens.min)} to ${fmtCount(summary.promptTokens.max)}) |`
  );
  // Named, not just measured. "10.3% of the window" prompts no action; "t2-ts-endpoint reached
  // 10.3%" says which fixture to look at first when context budgeting lands.
  const worst = [...summary.perFixture].sort((a, b) => b.peakContextRatio - a.peakContextRatio)[0];
  lines.push(
    `| Largest prompt seen, as a share of the window | ${(summary.maxPeakContextRatio * 100).toFixed(1)}%${worst ? `, by ${worst.fixtureId}` : ""} |`
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
  const falseFailures = run.records.filter(r => r.falseFailure);
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
