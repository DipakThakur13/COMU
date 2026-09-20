import type { Server } from "node:http";
import type { AgentEvent } from "@comu/protocol";
import { classifyProviderFailure, type Command, type ProviderFailureCounts } from "./types.js";

/**
 * Drives one task against a running COMU runtime and records what happened.
 *
 * The harness subscribes to the event stream, which is also what makes it a human observer under
 * the approval rules. That is deliberate: it lets the benchmark run at autonomy "ask" and count how
 * many approvals a task needs, rather than hiding the question behind "auto" and measuring a
 * product nobody uses.
 */

/**
 * What ends a task, as observed on the wire.
 *
 * Exactly the three the protocol defines. The runtime guarantees one of them on every path, so the
 * harness has nothing to compensate for. It deliberately does not treat agent.limit_reached as
 * terminal: doing so would paper over a runtime that failed to end its own task, which is a product
 * defect that belongs in the measurement rather than in the instrument.
 */
const TERMINAL = new Set(["task.completed", "task.failed", "task.cancelled"]);

export interface TaskOutcome {
  /** COMU's own verdict. Recorded, never used to decide correctness. */
  status: "completed" | "failed" | "cancelled" | "unknown";
  /** True when the run stopped at a step, tool call or repair limit. */
  limitReached: boolean;
  /**
   * Why the provider rejected a request, counted by cause.
   *
   * Kept apart because they mean different things and only some of them are COMU's. A gateway
   * refusal tracks request size and should fall once prompts get smaller. A timeout under
   * concurrency is usually the instrument's own contention arriving as a failed task, which is a
   * false failure the benchmark manufactured rather than anything the agent did. A rate limit says
   * the measurement is running too fast. Only the remainder is the provider genuinely refusing.
   */
  providerFailures: ProviderFailureCounts;
  finalText: string;
  /**
   * The assistant's last turn of prose, accumulated from the stream.
   *
   * The rubric tier grades what the agent said, and `finalText` carries that only when the task
   * ends cleanly: on a failure it holds the error instead. Without this, an onboarding answer was
   * graded against a runtime error message and scored zero however good the answer was.
   */
  assistantText: string;
  /**
   * COMU's own reason for ending the task, verbatim from the terminal event.
   *
   * Kept apart from finalText, which the caller replaces with the graded answer. Without it a false
   * failure records that COMU said "failed" but not what it said had gone wrong, and the cause of a
   * false failure is the whole point of counting them.
   */
  terminalError: string;
  events: AgentEvent[];
  approvalsRequested: number;
  clarificationsRequested: number;
  toolCalls: number;
  modelRequests: number;
  promptTokens: number;
  completionTokens: number;
  peakPromptTokens: number;
  planSteps: number;
  planVersions: number;
  repairAttempts: number;
  repairRecovered: boolean;
  verificationStatus?: string;
  /** Set when the harness itself could not complete the run. */
  harnessError?: string;
  limits: Record<string, number>;
}

export interface TaskRequestInput {
  baseUrl: string;
  headers: Record<string, string>;
  prompt: string;
  modelId: string;
  workspaceRoot: string;
  mode?: string;
  autonomy?: string;
  limits?: Record<string, number>;
  /** Hard stop for the whole run, independent of the agent's own budget. */
  timeoutMs: number;
}

export interface Counters {
  approvalsRequested: number;
  clarificationsRequested: number;
  toolCalls: number;
  modelRequests: number;
  promptTokens: number;
  completionTokens: number;
  peakPromptTokens: number;
  planSteps: number;
  planVersions: number;
  repairAttempts: number;
  repairRecovered: boolean;
  verificationStatus?: string;
  status: TaskOutcome["status"];
  limitReached: boolean;
  providerFailures: ProviderFailureCounts;
  finalText: string;
  assistantText: string;
  terminalError: string;
  streamBuffer: string;
}

/**
 * A fresh set of counters.
 *
 * Exported with `fold` so the accounting can be tested against a list of events directly. The
 * alternative is driving a real runtime to provoke each event, which is slow for the common cases
 * and impossible for the ones worth testing: a provider timeout cannot be produced on demand.
 */
export function createCounters(): Counters {
  return {
    approvalsRequested: 0,
    clarificationsRequested: 0,
    toolCalls: 0,
    modelRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    peakPromptTokens: 0,
    planSteps: 0,
    planVersions: 0,
    repairAttempts: 0,
    repairRecovered: false,
    status: "unknown",
    limitReached: false,
    providerFailures: { timeouts: 0, rateLimits: 0, gateway: 0, other: 0 },
    finalText: "",
    assistantText: "",
    terminalError: "",
    streamBuffer: ""
  };
}

export function fold(counters: Counters, event: AgentEvent): void {
  const e = event as unknown as Record<string, any>;
  switch (event.type) {
    case "tool.started":
      counters.toolCalls += 1;
      break;
    case "model.token_delta": {
      // The assistant's own turn only. A worker's deltas arrive on their own channel and are not
      // the answer to the user's question.
      if (e.channel === "main" && e.kind === "text" && typeof e.delta === "string") {
        counters.streamBuffer += e.delta;
      }
      break;
    }
    case "model_request.succeeded": {
      counters.modelRequests += 1;
      if (counters.streamBuffer.trim()) {
        counters.assistantText = counters.streamBuffer;
      }
      counters.streamBuffer = "";
      const usage = e.usage ?? {};
      const prompt = Number(usage.promptTokens ?? usage.prompt_tokens ?? 0);
      counters.promptTokens += prompt;
      counters.completionTokens += Number(usage.completionTokens ?? usage.completion_tokens ?? 0);
      // Peak rather than total: the window is a per-request ceiling, so the largest single
      // request is what decides whether a task can survive at all.
      counters.peakPromptTokens = Math.max(counters.peakPromptTokens, prompt);
      break;
    }
    case "plan.created":
    case "plan.updated":
      counters.planVersions = Math.max(counters.planVersions, Number(e.planVersion ?? 1));
      counters.planSteps = Array.isArray(e.plan?.steps) ? e.plan.steps.length : counters.planSteps;
      break;
    case "repair.started":
      counters.repairAttempts += 1;
      break;
    case "repair.completed":
      counters.repairRecovered = true;
      break;
    case "verification.completed":
      counters.verificationStatus = e.result?.status ?? counters.verificationStatus;
      break;
    case "model_request.timed_out":
      /*
       * A timeout arrives as its own event and never as model_request.failed.
       *
       * Counting only the failure event left this at zero however many requests were abandoned,
       * which is the one provider failure the benchmark is capable of causing for itself: under
       * concurrency a request that waits behind three others passes modelRequestTimeoutMs, the task
       * ends, and the run is recorded as a failure the agent did not commit.
       */
      counters.providerFailures.timeouts += 1;
      break;
    case "model_request.failed": {
      counters.providerFailures[classifyProviderFailure(String(e.error ?? ""))] += 1;
      break;
    }
    case "interaction.requested":
      if (e.interaction?.type === "APPROVAL") counters.approvalsRequested += 1;
      else counters.clarificationsRequested += 1;
      break;
    case "task.completed":
      counters.status = "completed";
      counters.finalText = String(e.finalText ?? "");
      break;
    case "task.failed":
      counters.status = "failed";
      counters.finalText = String(e.error ?? e.payload?.message ?? "");
      counters.terminalError = [e.payload?.code, counters.finalText].filter(Boolean).join(": ");
      break;
    case "task.cancelled":
      counters.status = "cancelled";
      counters.terminalError = String(e.reason ?? "cancelled");
      break;
    case "agent.limit_reached":
      // Not terminal. Recorded so a run that stopped at a limit can be told apart from one that
      // failed for another reason, but the task is over only when a task.* event says so.
      counters.limitReached = true;
      break;
    default:
      break;
  }
}

/**
 * Approves whatever is asked and counts it.
 *
 * The benchmark measures how much supervision a task needs, not whether a human would have said
 * yes. Denying would measure the agent's recovery from denial, which is a different question and
 * deserves its own fixtures.
 */
async function autoRespond(input: TaskRequestInput, taskId: string, event: AgentEvent): Promise<void> {
  const e = event as unknown as Record<string, any>;
  const interaction = e.interaction;
  if (!interaction?.interactionId) return;

  const response =
    interaction.type === "APPROVAL"
      ? { type: "APPROVE" }
      : { type: "INPUT", value: interaction.options?.[0]?.value ?? interaction.options?.[0] ?? "proceed" };

  await fetch(`${input.baseUrl}/v1/tasks/${taskId}/interactions/${interaction.interactionId}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...input.headers },
    body: JSON.stringify({ response })
  }).catch(() => {
    // A resolved or expired interaction is not the harness's problem; the counters already saw it.
  });
}

export async function runTask(input: TaskRequestInput): Promise<TaskOutcome> {
  const counters: Counters = createCounters();
  const events: AgentEvent[] = [];

  const created = await fetch(`${input.baseUrl}/v1/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...input.headers },
    body: JSON.stringify({
      prompt: input.prompt,
      modelId: input.modelId,
      mode: input.mode ?? "AUTO",
      autonomy: input.autonomy ?? "ask",
      workspace: { rootPath: input.workspaceRoot },
      ...(input.limits ? { limits: input.limits } : {})
    })
  });

  if (created.status !== 201) {
    const body = await created.text();
    const { streamBuffer: _unused, ...partial } = counters;
    return {
      ...partial,
      events,
      limits: {},
      harnessError: `Task creation failed with ${created.status}: ${body.slice(0, 500)}`
    };
  }

  const { taskId, limits } = (await created.json()) as { taskId: string; limits: Record<string, number> };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  let harnessError: string | undefined;

  try {
    const stream = await fetch(`${input.baseUrl}/v1/tasks/${taskId}/events`, {
      headers: input.headers,
      signal: controller.signal
    });
    if (!stream.ok || !stream.body) throw new Error(`Event stream failed with ${stream.status}`);

    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;

    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const line = frame.split("\n").find(l => l.startsWith("data:"));
        if (line) {
          const event = JSON.parse(line.slice(5).trim()) as AgentEvent;
          events.push(event);
          fold(counters, event);
          if (event.type === "interaction.requested") await autoRespond(input, taskId, event);
          if (TERMINAL.has(event.type)) {
            done = true;
            break;
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    controller.abort();
  } catch (error) {
    const err = error as { name?: string; message?: string };
    if (err?.name === "AbortError") {
      // The harness's own wall clock, not the agent's budget. Recorded separately so it is never
      // mistaken for the agent choosing to stop.
      harnessError = `Harness timeout after ${input.timeoutMs}ms`;
      await fetch(`${input.baseUrl}/v1/tasks/${taskId}/cancel`, { method: "POST", headers: input.headers }).catch(() => {});
    } else {
      harnessError = err?.message ?? String(error);
    }
  } finally {
    clearTimeout(timer);
  }

  // streamBuffer is scratch for accumulating the current turn; it is not part of the outcome.
  const { streamBuffer: _discard, ...outcome } = counters;
  return { ...outcome, events, limits: limits ?? {}, harnessError };
}

/** Starts a runtime on an ephemeral loopback port and returns how to talk to it. */
export async function startRuntime(
  createApp: (options: Record<string, unknown>) => { listen: Server["listen"] },
  options: Record<string, unknown> = {}
): Promise<{ baseUrl: string; headers: Record<string, string>; stop: () => Promise<void> }> {
  const token = `bench-${Math.random().toString(36).slice(2)}`;
  const app = createApp({ authToken: token, ...options });

  const server = await new Promise<Server>(resolve => {
    const s = (app as unknown as { listen: (p: number, h: string, cb: () => void) => Server }).listen(0, "127.0.0.1", () =>
      resolve(s)
    );
  });
  const port = (server.address() as { port: number }).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    headers: { authorization: `Bearer ${token}` },
    stop: () => new Promise<void>(resolve => server.close(() => resolve()))
  };
}

/** Pushes provider credentials into the runtime the way the extension does. */
export async function configureProvider(
  baseUrl: string,
  headers: Record<string, string>,
  config: Record<string, { apiKey?: string; endpoint?: string }>
): Promise<void> {
  await fetch(`${baseUrl}/v1/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ config })
  });
}

export type { Command };
