import { AgentEvent } from "@comu/protocol";

const TERMINAL_EVENTS = new Set(["task.completed", "task.failed", "task.cancelled", "agent.limit_reached"]);

/**
 * Subscribes to a task's SSE stream and resolves with every event seen once a terminal event arrives.
 */
export async function collectTaskEvents(
  baseUrl: string,
  taskId: string,
  headers: Record<string, string> = {},
  timeoutMs = 20000
): Promise<AgentEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const events: AgentEvent[] = [];

  try {
    const res = await fetch(`${baseUrl}/v1/tasks/${taskId}/events`, { headers, signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new Error(`SSE subscription failed with status ${res.status}`);
    }

    const reader = (res.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = frame.split("\n").find(l => l.startsWith("data:"));
        if (dataLine) {
          const event = JSON.parse(dataLine.slice(5).trim()) as AgentEvent;
          events.push(event);
          if (TERMINAL_EVENTS.has(event.type)) {
            controller.abort();
            return events;
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    return events;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return events;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
