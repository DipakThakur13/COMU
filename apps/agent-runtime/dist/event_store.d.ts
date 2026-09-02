import { AgentEvent } from "@comu/protocol";
export interface EventStoreOptions {
    maxEventsPerTask: number;
}
export interface TaskEventStore {
    append(event: AgentEvent): void;
    getEvents(taskId: string): AgentEvent[];
    clear(taskId: string): void;
}
export declare class InMemoryTaskEventStore implements TaskEventStore {
    private options;
    private eventsByTask;
    constructor(options?: EventStoreOptions);
    append(event: AgentEvent): void;
    getEvents(taskId: string): AgentEvent[];
    clear(taskId: string): void;
}
//# sourceMappingURL=event_store.d.ts.map