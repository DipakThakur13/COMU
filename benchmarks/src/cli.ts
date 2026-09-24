import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
// Imported from source rather than the package entry: the runtime ships a bundle, and the
// benchmark must exercise the code in this working tree.
import { createRuntimeApp, resolveTaskLimits } from "../../apps/agent-runtime/src/server.js";
import { fixturesRoot, loadFixtures } from "./fixture.js";
import { executeFixture } from "./execute.js";
import { summarise } from "./metrics.js";
import { DEFAULT_GATEWAY_MULTIPLE, gatewayBaseline, judgeGateway, probeGateway } from "./gateway.js";
import {
  acquireRunLock,
  appendMarker,
  appendMixedLimitsMarker,
  appendRecord,
  describeGatewayCheck,
  latestPerCell,
  readJournal,
  readJournalEvents,
  readJournalMarkers,
  readAnnotations,
  annotate,
  updateRunLock,
  writeRun
} from "./report.js";
import { cellKey, describeLimitDifferences, limitDifferences, planResume } from "./resume.js";
import { describeStatus } from "./status.js";
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
  /** Report on a run from its lock and journal, and measure nothing. */
  status: boolean;
  /** Launch into a gateway the launch gate judges too slow, and mark the journal as such. */
  acceptSlowGateway: boolean;
  /** The frozen run whose per-request latency the launch gate compares against. */
  gatewayBaseline: string;
  /** How many times the baseline's median latency the probed median may reach. */
  gatewayMultiple: number;
}

/** The journal's markers, as the optional fields of a run: each absent when there are none. */
function markersOf(outDir: string, label: string): Pick<BenchmarkRun, "mixedLimits" | "gatewayProbes" | "slowGateway"> {
  const mixed = readJournalMarkers(outDir, label);
  const probes = readJournalEvents(outDir, label, "gateway_probe");
  const slow = readJournalEvents(outDir, label, "slow_gateway");
  return {
    ...(mixed.length > 0 ? { mixedLimits: mixed } : {}),
    ...(probes.length > 0 ? { gatewayProbes: probes } : {}),
    ...(slow.length > 0 ? { slowGateway: slow } : {})
  };
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
    limits: parseLimits(get("limits") ?? readLimitsFile(get("limits-file"))),
    concurrency: Math.max(1, Number(get("concurrency") ?? 1)),
    reportOnly: argv.includes("--report-only"),
    redoProviderFailures: argv.includes("--redo-provider-failures"),
    acceptMixedLimits: argv.includes("--accept-mixed-limits"),
    status: argv.includes("--status"),
    acceptSlowGateway: argv.includes("--accept-slow-gateway"),
    gatewayBaseline: get("gateway-baseline") ?? "B0",
    gatewayMultiple: Number(get("gateway-multiple") ?? DEFAULT_GATEWAY_MULTIPLE)
  };
}

/**
 * The budget from a JSON file. A detached launch goes through Windows command-line quoting twice,
 * which JSON does not survive; a path does.
 */
function readLimitsFile(file: string | undefined): string | undefined {
  return file ? fs.readFileSync(file, "utf8") : undefined;
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

  if (args.status) {
    const scope = fixtures.flatMap(f => Array.from({ length: args.reps }, (_, i) => cellKey({ fixtureId: f.spec.id, rep: i + 1 })));
    for (const line of describeStatus({ outDir: args.outDir, label: args.label, scope })) console.log(line);
    return;
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
      ...markersOf(args.outDir, args.label)
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
  const { redo, done, standing } = planResume(previous, args.reps, args.redoProviderFailures);

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

  if (!args.selftest) {
    updateRunLock(args.outDir, args.label, state => {
      state.planned = jobs.map(j => cellKey({ fixtureId: j.fixture.spec.id, rep: j.rep }));
    });
  }

  /*
   * The launch gate.
   *
   * Only when there is something to measure, and on every launch including a resume: the provider
   * a resumed run meets is a new condition, and the journal records each one it was launched into.
   */
  if (!args.selftest && jobs.length > 0) {
    const passed = await gateLaunch(args, model, credentials[model.provider]?.apiKey ?? "");
    if (!passed) {
      releaseLock();
      process.exit(1);
    }
  }

  let started = 0;
  let finished = 0;

  const runJob = async ({ fixture, rep }: { fixture: (typeof fixtures)[number]; rep: number }) => {
    const label = `${fixture.spec.id} rep ${rep}/${args.reps}`;
    const cell = cellKey({ fixtureId: fixture.spec.id, rep });
    console.log(`[${++started}/${jobs.length}] start ${label}`);
    if (!args.selftest) {
      updateRunLock(args.outDir, args.label, state => {
        state.inFlight.push({ cell, startedAt: new Date().toISOString() });
      });
    }

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
          record.requestLatency ? `(request latency median ${(record.requestLatency.medianMs / 1000).toFixed(1)}s over ${record.requestLatency.count})` : "",
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
        if (!args.selftest) {
          updateRunLock(args.outDir, args.label, state => {
            state.inFlight = state.inFlight.filter(c => c.cell !== cell);
            state.finished.push(cell);
          });
        }
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
  if (summary.providerKilled.length > 0) {
    console.log(
      `Not measured, ended by the provider: ${summary.providerKilled.map(c => `${c.fixtureId} rep ${c.rep} (${c.cause})`).join(", ")}. ` +
        "Re-run the label with --redo-provider-failures to measure them."
    );
  }
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
    ...markersOf(args.outDir, args.label)
  };
  const written = writeRun(annotate(run, readAnnotations(args.outDir, args.label)), args.outDir);
  console.log(`\nWrote ${written.jsonPath}`);
  console.log(`Wrote ${written.markdownPath}`);
  releaseLock();
}

/**
 * Probes the provider and decides whether to launch. Writes what it found into the journal either
 * way, so the result says what provider it was measured against.
 */
async function gateLaunch(args: Args, model: { id: string; provider: string }, apiKey: string): Promise<boolean> {
  const refuse = (why: string): boolean => {
    console.error(`${why}\nRefusing to launch. Pass --accept-slow-gateway to launch anyway and mark the journal.`);
    return args.acceptSlowGateway;
  };

  const baseline = gatewayBaseline(args.outDir, args.gatewayBaseline);
  if (!baseline) return refuse(`No committed result for '${args.gatewayBaseline}' in ${args.outDir} to compare the gateway against.`);
  if (model.provider !== "nvidia") return refuse(`The launch gate can only probe NVIDIA, and this run uses ${model.provider}.`);

  const thresholdMs = Math.round(baseline.medianMs * args.gatewayMultiple);
  console.log(`Probing the gateway: three requests, one at a time, each capped at ${(thresholdMs / 1000).toFixed(0)}s.`);
  const probes = await probeGateway(model.id, apiKey, thresholdMs, (probe, i) =>
    console.log(`  probe ${i + 1}: ${probe.latencyMs === null ? `failed (${probe.error ?? "no answer"})` : `${(probe.latencyMs / 1000).toFixed(1)}s`}`)
  );
  const check = judgeGateway(probes, baseline, args.gatewayMultiple);
  const now = new Date().toISOString();
  appendMarker({ journalEvent: "gateway_probe", probedAt: now, check }, args.outDir, args.label);
  for (const line of describeGatewayCheck(check)) console.log(line);

  if (!check.slow) return true;
  if (!args.acceptSlowGateway) {
    refuse("The gateway is slower than the baseline allows, so this run would measure the provider, not COMU.");
    return false;
  }
  appendMarker({ journalEvent: "slow_gateway", acceptedAt: now, check }, args.outDir, args.label);
  console.error("Going ahead under --accept-slow-gateway. The journal is now marked as measured on a slow gateway.");
  return true;
}

/** The window the pinned model advertises, used to report peak prompt size as a share of it. */
function contextWindowFor(modelId: string): number {
  if (modelId.includes("astra")) return 1_050_000;
  if (modelId.includes("laguna")) return 32_768;
  return 128_000;
}

/*
 * Exit when main is done, rather than when the event loop drains.
 *
 * It never drained: after "Self test complete" a detached self test sat alive with nothing left to
 * do, held open by a handle something in the engine leaves behind. A run that does not end never
 * restores the machine's sleep setting, which the detached wrapper does after the run exits, and
 * its lock names a pid that is still alive, so --status reports it running forever. Every write
 * here is synchronous, so nothing is lost by exiting.
 */
main().then(
  () => process.exit(process.exitCode ?? 0),
  error => {
    console.error(error);
    process.exit(1);
  }
);
