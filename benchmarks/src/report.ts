import fs from "node:fs";
import path from "node:path";
import { TIER_NAMES, type BenchmarkRun, type Tier } from "./types.js";
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
  lines.push("");

  // Per fixture first, and no pooled rate anywhere. Averaging a fixture that always works with one
  // that never does reports something true of neither.
  lines.push("## Per fixture");
  lines.push("");
  lines.push("| Fixture | Tier | Correct |");
  lines.push("|---|---|---|");
  for (const entry of summary.perFixture) {
    const tier = TIER_NAMES[entry.tier as Tier] ?? entry.tier;
    lines.push(`| ${entry.fixtureId} | ${entry.tier} ${tier} | ${entry.correct} of ${entry.of} |`);
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
    `| Prompt tokens per run, median (range) | ${summary.promptTokens.median.toLocaleString()} (${summary.promptTokens.min.toLocaleString()} to ${summary.promptTokens.max.toLocaleString()}) |`
  );
  lines.push(`| Largest prompt seen, as a share of the window | ${(summary.maxPeakContextRatio * 100).toFixed(1)}% |`);
  lines.push("");

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
