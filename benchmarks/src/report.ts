import fs from "node:fs";
import path from "node:path";
import { TIER_NAMES, type BenchmarkRun, type Tier } from "./types.js";
import { summarise } from "./metrics.js";

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

  fs.writeFileSync(jsonPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(run), "utf8");
  return { jsonPath, markdownPath };
}

export function renderMarkdown(run: BenchmarkRun): string {
  const summary = summarise(run.records);
  const lines: string[] = [];

  lines.push(`# Benchmark run: ${run.label}`);
  lines.push("");
  lines.push(`Model \`${run.model.id}\` via ${run.model.provider}. Commit \`${run.gitCommit}\`.`);
  lines.push(`${run.reps} repetitions per fixture, ${summary.runs} runs, started ${run.startedAt}.`);
  lines.push("");

  lines.push("## Overall");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Correct | ${summary.correct} of ${summary.runs} |`);
  lines.push(`| Success rate | ${(summary.successRate * 100).toFixed(1)}% |`);
  lines.push(`| False completions | ${summary.falseCompletions} |`);
  lines.push(`| False failures | ${summary.falseFailures} |`);
  lines.push(`| Mean wall clock | ${(summary.meanDurationMs / 1000).toFixed(1)}s |`);
  lines.push(`| Mean prompt tokens per run | ${summary.meanPromptTokens.toLocaleString()} |`);
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

  lines.push("## Per fixture");
  lines.push("");
  lines.push("| Fixture | Tier | Correct |");
  lines.push("|---|---|---|");
  for (const entry of summary.perFixture) {
    const tier = TIER_NAMES[entry.tier as Tier] ?? entry.tier;
    lines.push(`| ${entry.fixtureId} | ${entry.tier} ${tier} | ${entry.correct} of ${entry.of} |`);
  }
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
