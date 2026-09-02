"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskSessionStore = void 0;
class TaskSessionStore {
    state = {
        status: "idle",
        events: [],
        changes: []
    };
    seenEvents = new Set();
    getState() {
        return this.state;
    }
    setOffline(offline) {
        if (offline && this.state.status !== 'offline') {
            // we don't want to override terminal states if possible, but for milestone 4, 
            // if offline, UI needs to know
            this.state.status = 'offline';
        }
        else if (!offline && this.state.status === 'offline') {
            this.state.status = 'idle'; // Reset so user can start
        }
    }
    startNewTask(taskId, prompt, modelId) {
        this.state = {
            taskId,
            prompt,
            modelId,
            status: "running",
            events: [],
            changes: []
        };
        this.seenEvents.clear();
    }
    addEvent(event) {
        const uniqueId = `${event.taskId}-${event.eventId}`;
        if (this.seenEvents.has(uniqueId)) {
            return false; // Deduplicated
        }
        this.seenEvents.add(uniqueId);
        this.state.events.push(event);
        // Update projected state based on event
        if (event.type === 'change.created') {
            const ce = event;
            // Upsert change
            const existing = this.state.changes.find(c => c.path === ce.path);
            if (!existing) {
                this.state.changes.push({ path: ce.path, operation: ce.operation });
            }
        }
        else if (event.type === 'task.completed') {
            this.state.status = 'completed';
        }
        else if (event.type === 'task.failed') {
            this.state.status = 'failed';
        }
        else if (event.type === 'task.cancelled') {
            this.state.status = 'cancelled';
        }
        else if (event.type === 'tool.completed') {
            const te = event;
            // If the final tool was complete, and we want to capture final output?
            // Actually agent.status or tool.completed usually contains the text.
            // For now we just keep the event list.
        }
        return true; // Added
    }
    setFinalResponse(text) {
        this.state.finalResponse = text;
    }
}
exports.TaskSessionStore = TaskSessionStore;
//# sourceMappingURL=task_session_store.js.map