import { AgentEvent } from "@comu/protocol";

export interface EventStoreOptions {
  maxEventsPerTask: number;
}

export interface TaskEventStore {
  append(event: AgentEvent): void;
  getEvents(taskId: string): AgentEvent[];
  clear(taskId: string): void;
}

export class InMemoryTaskEventStore implements TaskEventStore {
  private eventsByTask = new Map<string, AgentEvent[]>();

  constructor(private options: EventStoreOptions = { maxEventsPerTask: 5000 }) {}

  append(event: AgentEvent): void {
    let events = this.eventsByTask.get(event.taskId);
    if (!events) {
      events = [];
      this.eventsByTask.set(event.taskId, events);
    }

    events.push(event);

    // Bounded history: keep only the most recent maxEventsPerTask
    if (events.length > this.options.maxEventsPerTask) {
      events.splice(0, events.length - this.options.maxEventsPerTask);
    }
  }

  getEvents(taskId: string): AgentEvent[] {
    return this.eventsByTask.get(taskId) || [];
  }

  clear(taskId: string): void {
    this.eventsByTask.delete(taskId);
  }
}
