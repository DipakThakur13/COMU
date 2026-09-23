import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
// Imported from source rather than the package entry: the runtime ships a bundle, and the
// benchmark must exercise the code in this working tree.
import { createRuntimeApp, resolveTaskLimits } from "../../apps/agent-runtime/src/server.js";
import { fixturesRoot, loadFixtures } from "./fixture.js";
import { executeFixture } from "./execute.js";
import { summarise } from "./metrics.js";
import {
  acquireRunLock,
  appendMixedLimitsMarker,
  appendRecord,
  killedByProvider,
  latestPerCell,
  readJournal,
  readJournalMarkers,
  readAnnotations,
  annotate,
  writeRun
} from "./report.js";
import { describeLimitDifferences, limitDifferences } from "./resume.js";
import { configureProvider, startRuntime } from "./runner.js";
import { SelfTestModel } from "./selftest_model.js";
import { assertNoSecretInArgv, loadLocalEnv } from "./secrets.js";
import type { BenchmarkRun, RunRecord, Tier } from "./types.js";

/**
 * The benchmark entry point.
 *
 * Two modes. A measurement needs a real provider key and writes a committed result. A self test
 * needs nothing, drives a stand-in model that applies the golden solution, and refuses to write a
 * result: it proves the instrument works and says nothing about the agent.
 */

interface Args {
  label: string;
  reps: number;
  tier?: Tier;
  ids?: string[];
  modelId: string;
  selftest: boolean;
  timeoutMs: number;
  outDir: string;
  /** Budget override applied to every fixture that does not set its own. Recorded with the run. */
  limits?: Record<string, number>;
  /** How many runs execute at once. Recorded, because it makes wall clock an upper bound. */
  concurrency: number;
  /** Re-render the report from the journal without measuring anything. */
  reportOnly: boolean;
  /** Measure again any cell the provider killed, rather than letting it stand as a result. */
  redoProviderFailures: boolean;
  /** Resume under a budget that differs from the journal's, and mark the journal as mixed. */
  acceptMixedLimits: boolean;
}

/** The journal's mixed-budget markers, as the optional field of a run: absent when there are none. */
function mixedLimitsOf(outDir: string, label: string): Pick<BenchmarkRun, "mixedLimits"> {
  const markers = readJournalMarkers(outDir, label);
  return markers.length > 0 ? { mixedLimits: markers } : {};
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };

  return {
    label: get("label") ?? "adhoc",
    reps: Number(get("reps") ?? 1),
    tier: get("tier") as Tier | undefined,
    ids: get("fixture")?.split(","),
    // Pinned explicitly rather than defaulted by the runtime, so a result always names its model.
    modelId: get("model") ?? "nvidia/nemotron-3-ultra-550b-a55b",
    selftest: argv.includes("--selftest"),
    timeoutMs: Number(get("timeout") ?? 1_800_000),
    outDir: get("out") ?? path.resolve(path.dirname(fixturesRoot()), "results"),
    limits: parseLimits(get("limits")),
    concurrency: Math.max(1, Number(get("concurrency") ?? 1)),
    reportOnly: argv.includes("--report-only"),
    redoProviderFailures: argv.includes("--redo-provider-failures"),
    acceptMixedLimits: argv.includes("--accept-mixed-limits")
  };
}

/**
 * Budget override, as JSON.
 *
 * The runtime validates the contents and rejects an unknown key, so this only has to be an object
 * of numbers; a typo becomes a 400 naming the field rather than a silently ignored argument.
 */
function parseLimits(raw: string | undefined): Record<string, number> | undefined {
  if (!raw) return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--limits must be a JSON object, for example --limits '{\"maxExecutionTimeMs\":1800000}'");
  }
  return parsed as Record<string, number>;
}

/** The provider whose key is present, and the environment variable it came from. */
function resolveProvider(modelId: string): { provider: string; envVar: string; apiKey: string } | undefined {
  const candidates: Array<{ provider: string; envVar: string; match: (id: string) => boolean }> = [
    { provider: "nvidia", envVar: "NVIDIA_API_KEY", match: id => id.includes("/") || id.includes("nemotron") },
    { provider: "experiential", envVar: "EXPERIENTIAL_API_KEY", match: id => id.includes("astra") },
    { provider: "openai", envVar: "OPENAI_API_KEY", match: id => id.startsWith("gpt-") }
  ];
  for (const candidate of candidates) {
    const apiKey = process.env[candidate.envVar];
    if (candidate.match(modelId) && apiKey) return { provider: candidate.provider, envVar: candidate.envVar, apiKey };
  }
  return undefined;
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  // Before anything else: a credential on the command line is visible to every process on the
  // machine and lands in shell history.
  assertNoSecretInArgv(process.argv.slice(2));

  // A gitignored .env.local removes the need to type a credential at all. Names only are printed.
  for (const name of loadLocalEnv(path.dirname(fixturesRoot()))) {
    console.log(`Loaded ${name}`);
  }

  const args = parseArgs(process.argv.slice(2));
  const root = fixturesRoot();
  const fixtures = loadFixtures(root, { tier: args.tier, ids: args.ids });

  if (fixtures.length === 0) {
    console.error(`No fixtures matched under ${root}.`);
    process.exit(1);
  }

  /*
   * Re-render a finished run from its journal.
   *
   * The journal is the real result and the rendered files are a view of it, so a report can be
   * rebuilt without paying for the runs again. That matters when the reading of a record improves
   * after it was written: the failure classifier reached its provider verdict by looking for the
   * word "provider" in the error text, which NVIDIA's "504" message does not contain, and a run
   * takes hours so it cannot be corrected in flight. This re-reads the record and applies the
   * current reading to all of it at once.
   */
  if (args.reportOnly) {
    // Only the repetitions asked for: a run abandoned after rep 1 is a rep 1 result, and its header says so.
    const records = latestPerCell(readJournal(args.outDir, args.label)).filter(r => r.rep <= args.reps);
    if (records.length === 0) {
      console.error(`No journal for '${args.label}' in ${args.outDir}.`);
      process.exit(1);
    }
    const run: BenchmarkRun = {
      label: args.label,
      startedAt: records.map(r => r.startedAt).sort()[0],
      finishedAt: new Date().toISOString(),
      model: records[0].model,
      gitCommit: gitCommit(),
      reps: args.reps,
      concurrency: args.concurrency,
      records,
      ...mixedLimitsOf(args.outDir, args.label)
    };
    const written = writeRun(annotate(run, readAnnotations(args.outDir, args.label)), args.outDir);
    console.log(`Re-rendered ${records.length} records from the journal.`);
    console.log(`Wrote ${written.jsonPath}`);
    console.log(`Wrote ${written.markdownPath}`);
    return;
  }

  let model = { id: args.modelId, provider: "selftest" };
  let credentials: Record<string, { apiKey?: string }> = {};

  if (args.selftest) {
    console.log("Self test: driving a stand-in model. No result file will be written.");
    model = { id: "selftest-model", provider: "selftest" };
  } else {
    const resolved = resolveProvider(args.modelId);
    if (!resolved) {
      console.error(
        [
          `No API key for model '${args.modelId}'.`,
          "Set NVIDIA_API_KEY, EXPERIENTIAL_API_KEY or OPENAI_API_KEY.",
          "The benchmark will not substitute a small local model: that measures the model, not COMU.",
          "To exercise the harness without a key, run: pnpm bench:selftest"
        ].join("\n")
      );
      process.exit(1);
    }
    model = { id: args.modelId, provider: resolved.provider };
    credentials = { [resolved.provider]: { apiKey: resolved.apiKey } };
    console.log(`Model ${model.id} via ${model.provider} (key from ${resolved.envVar}).`);
  }

  /*
   * Anything already measured under this label today.
   *
   * A full benchmark takes hours, so a crash, a dropped connection or a closed laptop must not
   * throw away the provider time already spent. Re-running the same label resumes where it stopped.
   */
  /*
   * One runner per label.
   *
   * Taken before the journal is read, because the damage a second runner does is invisible: it
   * shares the journal, multiplies the provider load, and overwrites the result file with its own
   * partial set of records.
   */
  const releaseLock = args.selftest ? () => {} : acquireRunLock(args.outDir, args.label);
  process.on("exit", releaseLock);

  const previous = args.selftest ? [] : latestPerCell(readJournal(args.outDir, args.label));

  /*
   * A run the provider killed is not a measurement of COMU.
   *
   * A timeout under concurrency, or a gateway refusal mid-refactor, ends the task with whatever the
   * agent had done so far left half-applied, and the grader then reports a failure the agent did
   * not commit. Those cells are measured again rather than being allowed to stand. The original
   * record stays in the journal as the audit trail for why the cell was re-run; the later record
   * supersedes it.
   */
  // Only cells this invocation will run: a rep 1 resume neither re-measures nor is judged by rep 3.
  const inScope = previous.filter(r => r.rep <= args.reps);
  const redo = args.redoProviderFailures ? inScope.filter(killedByProvider) : [];
  const redoKeys = new Set(redo.map(r => `${r.fixtureId}#${r.rep}`));
  const done = new Set(previous.filter(r => !redoKeys.has(`${r.fixtureId}#${r.rep}`)).map(r => `${r.fixtureId}#${r.rep}`));

  if (previous.length > 0) {
    console.log(`Resuming '${args.label}': ${previous.length} runs already recorded.`);
  }
  if (redo.length > 0) {
    console.log(`Re-measuring ${redo.length} the provider killed: ${redo.map(r => `${r.fixtureId} rep ${r.rep}`).join(", ")}`);
  }

  /*
   * The budget is part of the instrument.
   *
   * Resolved exactly as the runtime resolves it, so an absent --limits compares as the runtime's
   * defaults rather than as "nothing requested". That absence is how B0 lost ten cells.
   */
  if (!args.selftest && previous.length > 0) {
    const incoming = new Map<string, Record<string, number>>();
    for (const fixture of fixtures) {
      const resolved = resolveTaskLimits(fixture.spec.limits ?? args.limits);
      if (!resolved.ok) {
        console.error(`Limits for ${fixture.spec.id} would be rejected by the runtime: ${resolved.message}`);
        process.exit(1);
      }
      incoming.set(fixture.spec.id, resolved.limits as unknown as Record<string, number>);
    }

    const standing = inScope.filter(r => !redoKeys.has(`${r.fixtureId}#${r.rep}`));
    const differences = limitDifferences(standing, id => incoming.get(id));
    if (differences.length > 0) {
      console.error(`The journal for '${args.label}' was measured under a different budget:`);
      for (const line of describeLimitDifferences(differences)) console.error(line);
      if (!args.acceptMixedLimits) {
        console.error(
          "\nRefusing to resume: the records would not form one measurement. Repeat the journal's " +
            "--limits, or pass --accept-mixed-limits to go ahead and mark the journal as mixed."
        );
        process.exit(1);
      }
      appendMixedLimitsMarker(
        { journalEvent: "mixed_limits", acceptedAt: new Date().toISOString(), differences },
        args.outDir,
        args.label
      );
      console.error("Going ahead under --accept-mixed-limits. The journal is now marked as mixed.");
    }
  }

  const records: RunRecord[] = [...previous];
  const startedAt = new Date().toISOString();

  /*
   * Every run still to do.
   *
   * Flattened so a pool can take them, and ordered rep-major rather than fixture-major: with
   * concurrency the workers then spread across different fixtures instead of all queueing behind
   * one fixture's virtual environment.
   */
  const jobs: Array<{ fixture: (typeof fixtures)[number]; rep: number }> = [];
  for (let rep = 1; rep <= args.reps; rep++) {
    for (const fixture of fixtures) {
      if (!done.has(`${fixture.spec.id}#${rep}`)) jobs.push({ fixture, rep });
    }
  }

  let started = 0;
  let finished = 0;

  const runJob = async ({ fixture, rep }: { fixture: (typeof fixtures)[number]; rep: number }) => {
    const label = `${fixture.spec.id} rep ${rep}/${args.reps}`;
    console.log(`[${++started}/${jobs.length}] start ${label}`);

    {
      // A fresh runtime per run, so no state, cache or session grant crosses between measurements.
      let providerFactory: (() => unknown) | undefined;
      if (args.selftest) {
        const golden = path.join(fixture.dir, "golden");
        const answerFile = path.join(fixture.dir, "golden", "ANSWER.txt");
        const isRubric = fixture.spec.grader.kind === "rubric";
        providerFactory = () =>
          new SelfTestModel(
            golden,
            isRubric ? "answer" : "apply",
            fs.existsSync(answerFile) ? fs.readFileSync(answerFile, "utf8") : ""
          );
      }

      const runtime = await startRuntime(
        createRuntimeApp as unknown as (o: Record<string, unknown>) => { listen: never },
        providerFactory ? { providerFactory } : {}
      );

      try {
        if (!args.selftest) await configureProvider(runtime.baseUrl, runtime.headers, credentials);
        else await configureProvider(runtime.baseUrl, runtime.headers, { [model.id]: { apiKey: "selftest" } });

        const record = await executeFixture({
          fixture,
          rep,
          baseUrl: runtime.baseUrl,
          headers: runtime.headers,
          model,
          contextWindow: args.selftest ? 128_000 : contextWindowFor(args.modelId),
          concurrency: args.concurrency,
          timeoutMs: args.timeoutMs,
          limits: args.limits
        });
        records.push(record);
        // Written the moment it exists, not at the end of a run that may not reach the end.
        if (!args.selftest) appendRecord(record, args.outDir, args.label);
        console.log(
          `[${++finished}/${jobs.length}] ${label}:`,
          record.grader.correct ? "correct" : `incorrect (${record.failureClass ?? "unclassified"})`,
          `${Math.round(record.durationMs / 1000)}s`,
          record.harnessError ? `[harness: ${record.harnessError}]` : ""
        );
        if (!record.grader.correct) {
          // The class alone does not tell anyone what to do about it. The reason and the offending
          // paths are what make a failed run diagnosable without opening the result file.
          console.log(`    ${record.grader.reason}`);
          if (record.unnecessaryChanges.length > 0) {
            console.log(`    outside the allowed paths: ${record.unnecessaryChanges.slice(0, 8).join(", ")}`);
          }
        }
      } catch (error) {
        console.log(`[${++finished}/${jobs.length}] ${label}: harness error`);
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      } finally {
        await runtime.stop();
      }
    }
  };

  /*
   * A fixed pool of workers over the job list.
   *
   * Each run has its own runtime on its own port and its own temporary workspace, so nothing is
   * shared and correctness, tokens and failure classes are unaffected by running several at once.
   * Wall clock is the exception: concurrent runs contend for the provider, so per-run latency is an
   * upper bound rather than a clean measurement. The level used is recorded with the result so a
   * reader knows which it is looking at.
   */
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(args.concurrency, jobs.length || 1)) }, async () => {
    while (next < jobs.length) {
      await runJob(jobs[next++]);
    }
  });
  await Promise.all(workers);

  const measured = latestPerCell(records).filter(r => r.rep <= args.reps);
  const summary = summarise(measured);
  console.log("");
  console.log(`${summary.correct} of ${summary.runs} correct.`);
  console.log(`False completions: ${summary.falseCompletions}. False failures: ${summary.falseFailures}.`);
  if (Object.keys(summary.failureCounts).length > 0) {
    console.log(`Failure classes: ${JSON.stringify(summary.failureCounts)}`);
  }

  if (args.selftest) {
    console.log("\nSelf test complete. No result written, because a stand-in model measures nothing.");
    return;
  }

  const run: BenchmarkRun = {
    label: args.label,
    startedAt,
    finishedAt: new Date().toISOString(),
    model,
    gitCommit: gitCommit(),
    reps: args.reps,
    concurrency: args.concurrency,
    records: measured,
    ...mixedLimitsOf(args.outDir, args.label)
  };
  const written = writeRun(annotate(run, readAnnotations(args.outDir, args.label)), args.outDir);
  console.log(`\nWrote ${written.jsonPath}`);
  console.log(`Wrote ${written.markdownPath}`);
  releaseLock();
}

/** The window the pinned model advertises, used to report peak prompt size as a share of it. */
function contextWindowFor(modelId: string): number {
  if (modelId.includes("astra")) return 1_050_000;
  if (modelId.includes("laguna")) return 32_768;
  return 128_000;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
