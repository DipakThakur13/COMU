import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModelRequestManager, RequestManagerConfig } from "../src/manager.js";
import { ModelProvider, ModelRequest, ModelResponse, ModelRequestContext } from "../src/index.js";
import {
  ProviderError,
  ProviderTimeoutError,
  ProviderCancelledError,
  ProviderAuthenticationError,
  ProviderInvalidRequestError,
  ProviderRateLimitError,
  ProviderUnknownError
} from "@comu/shared";
import { AgentEvent } from "@comu/protocol";

function createMockProvider(generateFn?: (req: ModelRequest, ctx?: ModelRequestContext) => Promise<ModelResponse>): ModelProvider {
  return {
    id: "test",
    name: "Test Provider",
    getCapabilities: () => ({
      toolCalling: true,
      streaming: false,
      reasoning: false,
      vision: false,
      structuredOutput: false,
      maxContextTokens: 4096
    }),
    generate: generateFn || (async () => ({
      text: "Hello world",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    }))
  };
}

const DEFAULT_REQUEST: ModelRequest = {
  prompt: "test prompt",
  systemPrompt: "system",
  messages: [{ role: "user", content: "test" }]
};

describe("ModelRequestManager", () => {
  let events: AgentEvent[];
  let onEvent: (event: AgentEvent) => void;

  beforeEach(() => {
    events = [];
    onEvent = (event: AgentEvent) => events.push(event);
  });

  // TEST R01 — Successful provider request
  it("R01: successful request emits created → started → succeeded", async () => {
    const provider = createMockProvider();
    const manager = new ModelRequestManager(provider, onEvent, { maxAttempts: 3, modelRequestTimeoutMs: 5000 });

    const response = await manager.execute("task-1", "run-1", DEFAULT_REQUEST);

    expect(response.text).toBe("Hello world");

    const types = events.map(e => e.type);
    expect(types).toContain("model_request.created");
    expect(types).toContain("model_request.started");
    expect(types).toContain("model_request.succeeded");
    expect(types).not.toContain("model_request.failed");
    expect(types).not.toContain("model_request.retrying");
  });

  // TEST R02 — Request ID remains stable across lifecycle
  it("R02: requestId remains stable across lifecycle events", async () => {
    const provider = createMockProvider();
    const manager = new ModelRequestManager(provider, onEvent);

    await manager.execute("task-1", "run-1", DEFAULT_REQUEST);

    const requestIds = events
      .filter(e => "requestId" in e)
      .map((e: any) => e.requestId);

    const uniqueIds = [...new Set(requestIds)];
    expect(uniqueIds).toHaveLength(1);
  });

  // TEST R03 — Retry increments attempt with same requestId
  it("R03: retry increments attempt, same requestId", async () => {
    let calls = 0;
    const provider = createMockProvider(async () => {
      calls++;
      if (calls === 1) {
        throw new ProviderError("Transient 500");
      }
      return { text: "recovered", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
    });

    const manager = new ModelRequestManager(provider, onEvent, {
      maxAttempts: 3,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
      maxRetryTimeMs: 10000,
      modelRequestTimeoutMs: 5000
    });

    const response = await manager.execute("task-1", "run-1", DEFAULT_REQUEST);
    expect(response.text).toBe("recovered");

    const retryEvent = events.find(e => e.type === "model_request.retrying") as any;
    expect(retryEvent).toBeTruthy();
    expect(retryEvent.nextAttempt).toBe(2);

    // Verify same requestId
    const requestIds = events
      .filter(e => "requestId" in e)
      .map((e: any) => e.requestId);
    const uniqueIds = [...new Set(requestIds)];
    expect(uniqueIds).toHaveLength(1);
  });

  // TEST R04 — Provider timeout
  it("R04: provider timeout emits timed_out event", async () => {
    const provider = createMockProvider(async () => {
      // Simulate a request that takes too long
      await new Promise(resolve => setTimeout(resolve, 5000));
      return { text: "late", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
    });

    const manager = new ModelRequestManager(provider, onEvent, {
      modelRequestTimeoutMs: 50,
      maxAttempts: 1,
      retryBaseDelayMs: 1,
      maxRetryTimeMs: 100
    });

    await expect(manager.execute("task-1", "run-1", DEFAULT_REQUEST)).rejects.toThrow(ProviderTimeoutError);

    const timedOutEvents = events.filter(e => e.type === "model_request.timed_out");
    expect(timedOutEvents.length).toBeGreaterThanOrEqual(1);
  });

  // TEST R06 — Cancellation before request
  it("R06: cancellation before request emits cancelled, no provider call", async () => {
    const generateFn = vi.fn(async () => ({
      text: "should not happen",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
    }));
    const provider = createMockProvider(generateFn);

    const controller = new AbortController();
    controller.abort(); // Already cancelled

    const manager = new ModelRequestManager(provider, onEvent);

    await expect(
      manager.execute("task-1", "run-1", DEFAULT_REQUEST, controller.signal)
    ).rejects.toThrow(ProviderCancelledError);

    expect(generateFn).not.toHaveBeenCalled();
    const types = events.map(e => e.type);
    expect(types).toContain("model_request.cancelled");
  });

  // TEST R07 — Cancellation during request
  it("R07: cancellation during request aborts and emits cancelled", async () => {
    const controller = new AbortController();
    const provider = createMockProvider(async (_req, ctx) => {
      // Simulate a long-running provider call that respects the signal
      return new Promise<ModelResponse>((resolve, reject) => {
        const checkAbort = () => {
          if (ctx?.signal?.aborted || controller.signal.aborted) {
            reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
            return;
          }
        };
        // Schedule the abort to fire while the request is pending
        setTimeout(() => controller.abort(), 20);
        // Check periodically if aborted
        const interval = setInterval(() => {
          if (ctx?.signal?.aborted || controller.signal.aborted) {
            clearInterval(interval);
            reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
          }
        }, 5);
        // Fallback resolve after a long time (should never be reached)
        setTimeout(() => {
          clearInterval(interval);
          resolve({ text: "should not complete", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
        }, 5000);
      });
    });

    const manager = new ModelRequestManager(provider, onEvent, {
      modelRequestTimeoutMs: 10000,
      maxAttempts: 1
    });

    await expect(
      manager.execute("task-1", "run-1", DEFAULT_REQUEST, controller.signal)
    ).rejects.toThrow(ProviderCancelledError);

    const types = events.map(e => e.type);
    expect(types).toContain("model_request.cancelled");
    expect(types).not.toContain("model_request.retrying");
  });

  // TEST R09 — Retryable transient error gets bounded retry
  it("R09: retryable transient error triggers bounded retry", async () => {
    let calls = 0;
    const provider = createMockProvider(async () => {
      calls++;
      throw new ProviderError("Transient 503");
    });

    const manager = new ModelRequestManager(provider, onEvent, {
      maxAttempts: 3,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
      maxRetryTimeMs: 10000,
      modelRequestTimeoutMs: 5000
    });

    await expect(manager.execute("task-1", "run-1", DEFAULT_REQUEST)).rejects.toThrow(ProviderError);
    expect(calls).toBe(3);
  });

  // TEST R10 — Non-retryable auth error: zero retries
  it("R10: auth error results in zero retries", async () => {
    let calls = 0;
    const provider = createMockProvider(async () => {
      calls++;
      throw new ProviderAuthenticationError("Invalid API key");
    });

    const manager = new ModelRequestManager(provider, onEvent, {
      maxAttempts: 3,
      retryBaseDelayMs: 1
    });

    await expect(manager.execute("task-1", "run-1", DEFAULT_REQUEST)).rejects.toThrow(ProviderAuthenticationError);
    expect(calls).toBe(1); // No retry
  });

  // TEST R11 — Invalid request: zero retries
  it("R11: invalid request results in zero retries", async () => {
    let calls = 0;
    const provider = createMockProvider(async () => {
      calls++;
      throw new ProviderInvalidRequestError("Bad payload");
    });

    const manager = new ModelRequestManager(provider, onEvent, {
      maxAttempts: 3,
      retryBaseDelayMs: 1
    });

    await expect(manager.execute("task-1", "run-1", DEFAULT_REQUEST)).rejects.toThrow(ProviderInvalidRequestError);
    expect(calls).toBe(1);
  });

  // TEST R13 — Maximum attempts reached
  it("R13: stops after maxAttempts", async () => {
    let calls = 0;
    const provider = createMockProvider(async () => {
      calls++;
      throw new ProviderRateLimitError("Rate limited");
    });

    const manager = new ModelRequestManager(provider, onEvent, {
      maxAttempts: 2,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
      maxRetryTimeMs: 10000,
      modelRequestTimeoutMs: 5000
    });

    await expect(manager.execute("task-1", "run-1", DEFAULT_REQUEST)).rejects.toThrow(ProviderRateLimitError);
    expect(calls).toBe(2);
  });

  // TEST R16 — Provider health does not equal task state
  it("R16: provider failure does not conflate with task state", async () => {
    const provider = createMockProvider(async () => {
      throw new ProviderError("Server error");
    });

    const manager = new ModelRequestManager(provider, onEvent, {
      maxAttempts: 1,
      modelRequestTimeoutMs: 5000
    });

    try {
      await manager.execute("task-1", "run-1", DEFAULT_REQUEST);
    } catch {
      // Expected
    }

    // Events should only reference model_request state, not agent/task state
    const types = events.map(e => e.type);
    expect(types).not.toContain("task.failed");
    expect(types).not.toContain("agent.status");
  });

  // TEST R17 — Request failure does not trigger code repair
  it("R17: provider failure does not emit diagnosing/repairing events", async () => {
    const provider = createMockProvider(async () => {
      throw new ProviderError("Network error");
    });

    const manager = new ModelRequestManager(provider, onEvent, {
      maxAttempts: 1,
      modelRequestTimeoutMs: 5000
    });

    try {
      await manager.execute("task-1", "run-1", DEFAULT_REQUEST);
    } catch {
      // Expected
    }

    const types = events.map(e => e.type);
    expect(types).not.toContain("diagnosis.created");
    expect(types).not.toContain("repair.started");
  });

  // TEST R18 — Secret sanitization
  it("R18: secrets are sanitized from error events", async () => {
    const provider = createMockProvider(async () => {
      throw new Error("Failed with Bearer nvapi-abc123xyz key=secret_token_value");
    });

    const manager = new ModelRequestManager(provider, onEvent, {
      maxAttempts: 1,
      modelRequestTimeoutMs: 5000
    });

    try {
      await manager.execute("task-1", "run-1", DEFAULT_REQUEST);
    } catch {
      // Expected
    }

    const failedEvents = events.filter(e => e.type === "model_request.failed") as any[];
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].error).not.toContain("nvapi-abc123xyz");
    expect(failedEvents[0].error).not.toContain("secret_token_value");
    expect(failedEvents[0].error).toContain("[REDACTED]");
  });

  // TEST R20 — Backoff increases per attempt
  it("R20: backoff delays increase with attempts", async () => {
    let calls = 0;
    const callTimestamps: number[] = [];
    const provider = createMockProvider(async () => {
      calls++;
      callTimestamps.push(Date.now());
      throw new ProviderError("Transient");
    });

    const manager = new ModelRequestManager(provider, onEvent, {
      maxAttempts: 3,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 1000,
      maxRetryTimeMs: 10000,
      modelRequestTimeoutMs: 5000
    });

    try {
      await manager.execute("task-1", "run-1", DEFAULT_REQUEST);
    } catch {
      // Expected
    }

    expect(calls).toBe(3);
    // Verify delays exist between attempts (accounting for jitter)
    if (callTimestamps.length >= 3) {
      const delay1 = callTimestamps[1] - callTimestamps[0];
      const delay2 = callTimestamps[2] - callTimestamps[1];
      expect(delay1).toBeGreaterThan(0);
      expect(delay2).toBeGreaterThanOrEqual(delay1 * 0.5); // Exponential with jitter
    }
  });

  // TEST — Cancellation never triggers retry
  it("cancellation during backoff stops retry loop", async () => {
    const controller = new AbortController();
    let calls = 0;
    const provider = createMockProvider(async () => {
      calls++;
      if (calls === 1) {
        // After first failure, schedule abort during backoff
        setTimeout(() => controller.abort(), 5);
        throw new ProviderError("Transient");
      }
      return { text: "recovered", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
    });

    const manager = new ModelRequestManager(provider, onEvent, {
      maxAttempts: 5,
      retryBaseDelayMs: 500,
      retryMaxDelayMs: 1000,
      maxRetryTimeMs: 10000,
      modelRequestTimeoutMs: 5000
    });

    await expect(
      manager.execute("task-1", "run-1", DEFAULT_REQUEST, controller.signal)
    ).rejects.toThrow(ProviderCancelledError);

    expect(calls).toBe(1); // Only first call, cancelled during backoff
  });

  // TEST — taskId and runId correlation
  it("all events carry correct taskId and runId", async () => {
    const provider = createMockProvider();
    const manager = new ModelRequestManager(provider, onEvent);

    await manager.execute("my-task-42", "my-run-99", DEFAULT_REQUEST);

    for (const event of events) {
      expect(event.taskId).toBe("my-task-42");
      if ("runId" in event) {
        expect((event as any).runId).toBe("my-run-99");
      }
    }
  });
});
