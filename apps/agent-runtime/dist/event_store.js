"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryTaskEventStore = void 0;
class InMemoryTaskEventStore {
    options;
    eventsByTask = new Map();
    constructor(options = { maxEventsPerTask: 5000 }) {
        this.options = options;
    }
    append(event) {
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
    getEvents(taskId) {
        return this.eventsByTask.get(taskId) || [];
    }
    clear(taskId) {
        this.eventsByTask.delete(taskId);
    }
}
exports.InMemoryTaskEventStore = InMemoryTaskEventStore;
//# sourceMappingURL=event_store.js.map