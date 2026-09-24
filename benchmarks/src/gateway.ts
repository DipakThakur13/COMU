import fs from "node:fs";
import path from "node:path";
// From source, like the runtime itself: the probe must take the request path this working tree takes.
import { NvidiaProvider } from "../../providers/nvidia/src/index.js";
import { summarise } from "./metrics.js";
import type { BenchmarkRun, GatewayBaseline, GatewayCheck, GatewayProbe } from "./types.js";

/**
 * Whether the provider is fast enough, right now, to measure against.
 *
 * B1 launched into a gateway four to seven times slower than the one B0 measured, because the
 * watcher that cleared it accepted any 200 inside the request timeout. Two cells in, one request had
 * taken 515 seconds and another cell had spent 267 seconds per request, against B0's median of 71.
 * A run measured under that gateway reports the provider's latency as COMU's, and its budgets bite
 * where B0's did not. A 200 says the provider is up; only latency says it is the same provider.
 */

export const DEFAULT_GATEWAY_MULTIPLE = 2;
const PROBES = 3;

/**
 * The frozen baseline's per-request latency, from its committed result.
 *
 * Read from the rendered result rather than the journal, because the result holds exactly the
 * records that were frozen: B0's journal also holds the repetitions abandoned after rep 1. The
 * measured per-request latency is used when the baseline recorded it; otherwise wall clock per
 * successful request, which is how B0's 71 seconds was computed and which every record carries.
 */
export function gatewayBaseline(outDir: string, label: string): GatewayBaseline | undefined {
  const results = fs
    .readdirSync(outDir)
    .filter(name => name.endsWith(`-${label}.json`))
    .sort();
  const latest = results[results.length - 1];
  if (!latest) return undefined;

  const run = JSON.parse(fs.readFileSync(path.join(outDir, latest), "utf8")) as BenchmarkRun;
  const summary = summarise(run.records);
  if (summary.requestLatencyMs) {
    return { label, source: latest, measure: "request_latency", medianMs: summary.requestLatencyMs.median, cells: run.records.length };
  }
  if (summary.wallClockPerRequestMs.max > 0) {
    return {
      label,
      source: latest,
      measure: "wall_clock_per_request",
      medianMs: Math.round(summary.wallClockPerRequestMs.median),
      cells: run.records.length
    };
  }
  return undefined;
}

/**
 * The median of the probes, where a probe that failed or did not answer within the cap counts as
 * slower than anything that did. Null when that is where the median falls: the gateway is at least
 * as slow as the cap, and how much slower is not worth waiting to find out.
 */
export function probeMedian(probes: GatewayProbe[]): number | null {
  const values = probes.map(p => p.latencyMs ?? Number.POSITIVE_INFINITY).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  return Number.isFinite(median) ? median : null;
}

/** Whether the gateway may be launched into. */
export function judgeGateway(probes: GatewayProbe[], baseline: GatewayBaseline, multiple: number): GatewayCheck {
  const thresholdMs = Math.round(baseline.medianMs * multiple);
  const medianMs = probeMedian(probes);
  return { probes, medianMs, thresholdMs, multiple, baseline, slow: medianMs === null || medianMs > thresholdMs };
}

/**
 * One minimal request, through the provider class the runtime uses, so the probe takes the same
 * endpoint, headers and streaming path a task's requests do.
 *
 * The key comes from this process's environment, which the harness loaded from .env.local; it is
 * never an argument and never printed. An error message is kept, since a provider can say something
 * useful, and is checked for the credential by whoever writes it down.
 */
export async function probeOnce(modelId: string, apiKey: string, capMs: number): Promise<GatewayProbe> {
  const provider = new NvidiaProvider(apiKey, undefined, modelId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), capMs);
  const startedAt = Date.now();
  const at = new Date(startedAt).toISOString();
  try {
    await provider.generate(
      { prompt: "ping", messages: [{ role: "user", content: "ping" }], maxTokens: 1, model: modelId },
      {
        requestId: `gateway-probe-${startedAt}`,
        taskId: "gateway-probe",
        runId: "gateway-probe",
        timeoutMs: capMs,
        signal: controller.signal,
        attempt: 1,
        maxAttempts: 1,
        startedAt
      }
    );
    return { at, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const message = controller.signal.aborted
      ? `no answer within ${(capMs / 1000).toFixed(0)}s`
      : String((error as Error)?.message ?? error).slice(0, 200);
    return { at, latencyMs: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Three probes, one at a time, never overlapping, so a struggling gateway is not handed more load
 * by the thing checking on it. Each is capped at the threshold: past that, the answer is already
 * "too slow".
 */
export async function probeGateway(
  modelId: string,
  apiKey: string,
  capMs: number,
  onProbe: (probe: GatewayProbe, index: number) => void = () => {}
): Promise<GatewayProbe[]> {
  const probes: GatewayProbe[] = [];
  for (let i = 0; i < PROBES; i++) {
    const probe = await probeOnce(modelId, apiKey, capMs);
    probes.push(probe);
    onProbe(probe, i);
  }
  return probes;
}
