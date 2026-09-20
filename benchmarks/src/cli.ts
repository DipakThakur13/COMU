import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
// Imported from source rather than the package entry: the runtime ships a bundle, and the
// benchmark must exercise the code in this working tree.
import { createRuntimeApp } from "../../apps/agent-runtime/src/server.js";
import { fixturesRoot, loadFixtures } from "./fixture.js";
import { executeFixture } from "./execute.js";
import { summarise } from "./metrics.js";
import { appendRecord, readJournal, writeRun } from "./report.js";
import { configureProvider, startRuntime } from "./runner.js";
import { SelfTestModel } from "./selftest_model.js";
import { assertNoSecretInArgv } from "./secrets.js";
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
    limits: parseLimits(get("limits"))
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

  const args = parseArgs(process.argv.slice(2));
  const root = fixturesRoot();
  const fixtures = loadFixtures(root, { tier: args.tier, ids: args.ids });

  if (fixtures.length === 0) {
    console.error(`No fixtures matched under ${root}.`);
    process.exit(1);
  }

  let model = { id: args.modelId, provider: "selftest" };
  let providerFactory: ((selection: unknown) => unknown) | undefined;
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
  const previous = args.selftest ? [] : readJournal(args.outDir, args.label);
  const done = new Set(previous.map(r => `${r.fixtureId}#${r.rep}`));
  if (previous.length > 0) {
    console.log(`Resuming '${args.label}': ${previous.length} runs already recorded.`);
  }

  const records: RunRecord[] = [...previous];
  const startedAt = new Date().toISOString();

  for (const fixture of fixtures) {
    for (let rep = 1; rep <= args.reps; rep++) {
      if (done.has(`${fixture.spec.id}#${rep}`)) continue;

      // A fresh runtime per run, so no state, cache or session grant crosses between measurements.
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

        process.stdout.write(`${fixture.spec.id} rep ${rep}/${args.reps} ... `);
        const record = await executeFixture({
          fixture,
          rep,
          baseUrl: runtime.baseUrl,
          headers: runtime.headers,
          model,
          contextWindow: args.selftest ? 128_000 : contextWindowFor(args.modelId),
          timeoutMs: args.timeoutMs,
          limits: args.limits
        });
        records.push(record);
        // Written the moment it exists, not at the end of a run that may not reach the end.
        if (!args.selftest) appendRecord(record, args.outDir, args.label);
        console.log(
          record.grader.correct ? "correct" : `incorrect (${record.failureClass ?? "unclassified"})`,
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
        console.log("harness error");
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      } finally {
        await runtime.stop();
      }
    }
  }

  const summary = summarise(records);
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
    records
  };
  const written = writeRun(run, args.outDir);
  console.log(`\nWrote ${written.jsonPath}`);
  console.log(`Wrote ${written.markdownPath}`);
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
