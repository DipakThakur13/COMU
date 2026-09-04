import {
  InteractionRequest,
  InteractionResponse,
  InteractionType,
  AgentEvent
} from "@comu/protocol";

interface PendingDeferred {
  request: InteractionRequest;
  resolve: (res: any) => void;
  reject: (err: any) => void;
  timer: NodeJS.Timeout;
}

export class InteractionManager {
  private pendingInteractions = new Map<string, PendingDeferred>(); // key: interactionId
  private defaultTimeoutMs = 10 * 60 * 1000; // 10 minutes

  constructor(defaultTimeoutMs?: number) {
    if (defaultTimeoutMs) {
      this.defaultTimeoutMs = defaultTimeoutMs;
    }
  }

  public getPendingInteraction(taskId: string): InteractionRequest | undefined {
    for (const item of this.pendingInteractions.values()) {
      if (item.request.taskId === taskId && item.request.status === "PENDING") {
        return item.request;
      }
    }
    return undefined;
  }

  public async requestInput(
    taskId: string,
    title: string,
    message: string,
    options?: string[],
    timeoutMs?: number,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const interactionId = `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;
    const expiresAt = new Date(Date.now() + effectiveTimeout).toISOString();

    const request: InteractionRequest = {
      interactionId,
      taskId,
      type: "INPUT",
      title,
      message,
      options,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      expiresAt
    };

    return new Promise<string>((resolve, reject) => {
      let abortHandler: (() => void) | undefined;

      const timer = setTimeout(() => {
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
        }
        this.pendingInteractions.delete(interactionId);
        request.status = "EXPIRED";

        if (onEvent) {
          onEvent({
            type: "interaction.expired",
            eventId: `evt-${Date.now()}`,
            taskId,
            timestamp: new Date().toISOString(),
            interactionId
          });
        }

        reject(new Error("USER_INPUT_TIMEOUT: Interaction timed out waiting for user response."));
      }, effectiveTimeout);

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(new Error("Task was cancelled while waiting for user interaction."));
          return;
        }

        abortHandler = () => {
          clearTimeout(timer);
          this.pendingInteractions.delete(interactionId);
          reject(new Error("Task was cancelled while waiting for user interaction."));
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      this.pendingInteractions.set(interactionId, {
        request,
        resolve: (val: string) => {
          clearTimeout(timer);
          if (signal && abortHandler) {
            signal.removeEventListener("abort", abortHandler);
          }
          resolve(val);
        },
        reject: (err: any) => {
          clearTimeout(timer);
          if (signal && abortHandler) {
            signal.removeEventListener("abort", abortHandler);
          }
          reject(err);
        },
        timer
      });

      if (onEvent) {
        onEvent({
          type: "interaction.requested",
          eventId: `evt-${Date.now()}`,
          taskId,
          timestamp: new Date().toISOString(),
          interactionId,
          interaction: request
        });
      }
    });
  }

  public async requestApproval(
    taskId: string,
    title: string,
    message: string,
    timeoutMs?: number,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<boolean> {
    const interactionId = `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;
    const expiresAt = new Date(Date.now() + effectiveTimeout).toISOString();

    const request: InteractionRequest = {
      interactionId,
      taskId,
      type: "APPROVAL",
      title,
      message,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      expiresAt
    };

    return new Promise<boolean>((resolve, reject) => {
      let abortHandler: (() => void) | undefined;

      const timer = setTimeout(() => {
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
        }
        this.pendingInteractions.delete(interactionId);
        request.status = "EXPIRED";

        if (onEvent) {
          onEvent({
            type: "interaction.expired",
            eventId: `evt-${Date.now()}`,
            taskId,
            timestamp: new Date().toISOString(),
            interactionId
          });
        }

        // Implicit denial on expiration
        resolve(false);
      }, effectiveTimeout);

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(new Error("Task was cancelled while waiting for user interaction."));
          return;
        }

        abortHandler = () => {
          clearTimeout(timer);
          this.pendingInteractions.delete(interactionId);
          reject(new Error("Task was cancelled while waiting for user interaction."));
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      this.pendingInteractions.set(interactionId, {
        request,
        resolve: (val: boolean) => {
          clearTimeout(timer);
          if (signal && abortHandler) {
            signal.removeEventListener("abort", abortHandler);
          }
          resolve(val);
        },
        reject: (err: any) => {
          clearTimeout(timer);
          if (signal && abortHandler) {
            signal.removeEventListener("abort", abortHandler);
          }
          reject(err);
        },
        timer
      });

      if (onEvent) {
        onEvent({
          type: "interaction.requested",
          eventId: `evt-${Date.now()}`,
          taskId,
          timestamp: new Date().toISOString(),
          interactionId,
          interaction: request
        });
      }
    });
  }

  public resolveInteraction(
    taskId: string,
    interactionId: string,
    response: InteractionResponse,
    onEvent?: (e: AgentEvent) => void
  ): boolean {
    const item = this.pendingInteractions.get(interactionId);
    if (!item) {
      return false; // Non-existent or already resolved
    }

    if (item.request.taskId !== taskId) {
      return false; // Wrong task
    }

    if (item.request.status !== "PENDING") {
      return false; // Stale or already resolved
    }

    item.request.status = "RESOLVED";
    item.request.resolvedAt = new Date().toISOString();
    item.request.response = response;

    this.pendingInteractions.delete(interactionId);

    if (onEvent) {
      onEvent({
        type: "interaction.responded",
        eventId: `evt-${Date.now()}`,
        taskId,
        timestamp: new Date().toISOString(),
        interactionId,
        response
      });
    }

    if (item.request.type === "INPUT") {
      if (response.type === "INPUT") {
        item.resolve(response.value);
      } else {
        item.reject(new Error("Invalid response type for INPUT interaction."));
      }
    } else if (item.request.type === "APPROVAL") {
      if (response.type === "APPROVE") {
        item.resolve(true);
      } else {
        item.resolve(false);
      }
    }

    return true;
  }

  public cancelTaskInteractions(taskId: string): void {
    for (const [id, item] of this.pendingInteractions.entries()) {
      if (item.request.taskId === taskId) {
        clearTimeout(item.timer);
        item.reject(new Error("Task was cancelled."));
        this.pendingInteractions.delete(id);
      }
    }
  }
}
