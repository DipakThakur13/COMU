import { ModelProvider, ModelRequest, ModelResponse, ModelRequestContext } from "./index.js";
import { 
  ProviderError, 
  ProviderTimeoutError, 
  ProviderCancelledError, 
  ProviderUnknownError,
  ProviderAuthenticationError,
  ProviderAuthorizationError,
  ProviderInvalidRequestError
} from "@comu/shared";
import { 
  ModelRequestCreatedEvent, 
  ModelRequestStartedEvent, 
  ModelRequestSucceededEvent, 
  ModelRequestFailedEvent, 
  ModelRequestTimedOutEvent, 
  ModelRequestCancelledEvent, 
  ModelRequestRetryingEvent,
  AgentEvent
} from "@comu/protocol";

export interface RequestManagerConfig {
  modelRequestTimeoutMs?: number;
  maxAttempts?: number;
  maxRetryTimeMs?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

export class ModelRequestManager {
  private config: Required<RequestManagerConfig>;

  constructor(
    private provider: ModelProvider,
    private onEvent: (event: AgentEvent) => void,
    config?: RequestManagerConfig
  ) {
    this.config = {
      modelRequestTimeoutMs: config?.modelRequestTimeoutMs ?? 120_000,
      maxAttempts: config?.maxAttempts ?? 3,
      maxRetryTimeMs: config?.maxRetryTimeMs ?? 60_000,
      retryBaseDelayMs: config?.retryBaseDelayMs ?? 500,
      retryMaxDelayMs: config?.retryMaxDelayMs ?? 8_000
    };
  }

  private isRetryable(error: any): boolean {
    if (error instanceof ProviderAuthenticationError) return false;
    if (error instanceof ProviderAuthorizationError) return false;
    if (error instanceof ProviderInvalidRequestError) return false;
    if (error instanceof ProviderCancelledError) return false;
    if (error?.name === "AbortError") return false;
    // Everything else (timeouts, rate limits, 5xx, unknown network drops) is retryable
    return true;
  }

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new ProviderCancelledError("Request cancelled during backoff"));
      }
      const timer = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new ProviderCancelledError("Request cancelled during backoff"));
        }, { once: true });
      }
    });
  }

  private sanitizeError(error: any): string {
    const message = error?.message || String(error);
    // Best-effort sanitization of common credential patterns
    return message
      .replace(/Bearer\s+[A-Za-z0-9\-\._~+\/]+=*/g, "Bearer [REDACTED]")
      .replace(/key=[A-Za-z0-9\-\._~+\/]+=*/gi, "key=[REDACTED]")
      .replace(/token=[A-Za-z0-9\-\._~+\/]+=*/gi, "token=[REDACTED]");
  }

  public async execute(
    taskId: string, 
    runId: string, 
    request: ModelRequest, 
    parentSignal?: AbortSignal
  ): Promise<ModelResponse> {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const startTime = Date.now();
    let attempt = 1;

    this.onEvent({
      type: "model_request.created",
      eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      taskId,
      timestamp: new Date().toISOString(),
      requestId,
      runId,
      attempt
    } as ModelRequestCreatedEvent);

    while (attempt <= this.config.maxAttempts) {
      if (parentSignal?.aborted) {
        const err = new ProviderCancelledError("Request cancelled before start");
        this.emitCancelled(taskId, runId, requestId, attempt);
        throw err;
      }

      this.onEvent({
        type: "model_request.started",
        eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        taskId,
        timestamp: new Date().toISOString(),
        requestId,
        runId,
        attempt
      } as ModelRequestStartedEvent);

      const attemptStartTime = Date.now();
      const controller = new AbortController();
      let timer: NodeJS.Timeout | undefined;

      const onParentAbort = () => controller.abort();
      if (parentSignal) {
        parentSignal.addEventListener("abort", onParentAbort);
      }

      const context: ModelRequestContext = {
        requestId,
        taskId,
        runId,
        timeoutMs: this.config.modelRequestTimeoutMs,
        signal: controller.signal,
        attempt,
        maxAttempts: this.config.maxAttempts,
        startedAt: attemptStartTime
      };

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new ProviderTimeoutError(`Provider request timed out after ${this.config.modelRequestTimeoutMs}ms`));
          }, this.config.modelRequestTimeoutMs);
        });

        const generatePromise = this.provider.generate(request, context);
        const response = await Promise.race([generatePromise, timeoutPromise]);

        const latencyMs = Date.now() - attemptStartTime;
        this.onEvent({
          type: "model_request.succeeded",
          eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          taskId,
          timestamp: new Date().toISOString(),
          requestId,
          runId,
          attempt,
          latencyMs
        } as ModelRequestSucceededEvent);

        return response;

      } catch (error: any) {
        const isTimeout = error instanceof ProviderTimeoutError;
        const isAbort = error.name === "AbortError" || parentSignal?.aborted;
        const elapsedTotal = Date.now() - startTime;
        
        let sanitizedMessage = this.sanitizeError(error);

        if (isAbort) {
          this.emitCancelled(taskId, runId, requestId, attempt);
          throw new ProviderCancelledError(sanitizedMessage);
        }

        if (isTimeout) {
          this.onEvent({
            type: "model_request.timed_out",
            eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            taskId,
            timestamp: new Date().toISOString(),
            requestId,
            runId,
            attempt,
            timeoutMs: this.config.modelRequestTimeoutMs
          } as ModelRequestTimedOutEvent);
        } else {
          this.onEvent({
            type: "model_request.failed",
            eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            taskId,
            timestamp: new Date().toISOString(),
            requestId,
            runId,
            attempt,
            error: sanitizedMessage
          } as ModelRequestFailedEvent);
        }

        const retryable = this.isRetryable(error);
        if (!retryable || attempt >= this.config.maxAttempts) {
          if (!retryable && !isTimeout && !(error instanceof ProviderError)) {
            throw new ProviderUnknownError(sanitizedMessage);
          }
          throw error;
        }

        // Calculate backoff
        const delay = Math.min(
          this.config.retryMaxDelayMs,
          this.config.retryBaseDelayMs * Math.pow(2, attempt - 1)
        );
        // Add jitter +/- 10%
        const jitter = delay * 0.1 * (Math.random() * 2 - 1);
        const finalDelay = Math.round(delay + jitter);

        if (elapsedTotal + finalDelay > this.config.maxRetryTimeMs) {
          throw error; // Exceeded retry budget
        }

        this.onEvent({
          type: "model_request.retrying",
          eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          taskId,
          timestamp: new Date().toISOString(),
          requestId,
          runId,
          attempt,
          delayMs: finalDelay,
          nextAttempt: attempt + 1
        } as ModelRequestRetryingEvent);

        try {
          await this.sleep(finalDelay, parentSignal);
        } catch (sleepErr) {
          if (sleepErr instanceof ProviderCancelledError) {
            this.emitCancelled(taskId, runId, requestId, attempt);
            throw sleepErr;
          }
          throw sleepErr;
        }

        attempt++;
      } finally {
        if (timer) clearTimeout(timer);
        if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
      }
    }

    throw new ProviderUnknownError("Max attempts reached unexpectedly");
  }

  private emitCancelled(taskId: string, runId: string, requestId: string, attempt: number) {
    this.onEvent({
      type: "model_request.cancelled",
      eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      taskId,
      timestamp: new Date().toISOString(),
      requestId,
      runId,
      attempt
    } as ModelRequestCancelledEvent);
  }
}
