import type { Server } from "node:http";
import type { AgentEvent } from "@comu/protocol";
import type { Command } from "./types.js";

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
 * agent.limit_reached is in this set because the runtime does not follow it with a task.* event:
 * an orchestrator run that ends at a step, tool-call or repair limit returns without publishing a
 * terminal event, and the stream simply closes. A subscriber that waits for task.failed therefore
 * waits forever. Recorded here as its own status rather than smoothed into "failed", so the
 * baseline shows how often it happens.
 */
const TERMINAL = new Set(["task.completed", "task.failed", "task.cancelled", "agent.limit_reached"]);

export interface TaskOutcome {
  /** COMU's own verdict. Recorded, never used to decide correctness. */
  status: "completed" | "failed" | "cancelled" | "limit_reached" | "unknown";
  finalText: string;
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

interface Counters {
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
  finalText: string;
}

function fold(counters: Counters, event: AgentEvent): void {
  const e = event as unknown as Record<string, any>;
  switch (event.type) {
    case "tool.started":
      counters.toolCalls += 1;
      break;
    case "model_request.succeeded": {
      counters.modelRequests += 1;
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
      break;
    case "task.cancelled":
      counters.status = "cancelled";
      break;
    case "agent.limit_reached":
      counters.status = "limit_reached";
      counters.finalText = `Limit reached: ${String(e.limit ?? "unknown")}`;
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
  const counters: Counters = {
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
    finalText: ""
  };
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
    return {
      ...counters,
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

  return { ...counters, events, limits: limits ?? {}, harnessError };
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
