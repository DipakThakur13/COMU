import { AgentEvent, ChangeCreatedEvent, TaskFailedEvent, ToolCompletedEvent } from '@comu/protocol';
import { ChatSessionStateUI } from '../protocol/messages';

export class TaskSessionStore {
    private state: ChatSessionStateUI = {
        status: "idle",
        events: [],
        changes: []
    };
    
    private seenEvents = new Set<string>();

    public getState(): ChatSessionStateUI {
        return this.state;
    }

    public setOffline(offline: boolean) {
        if (offline && this.state.status !== 'offline') {
            // we don't want to override terminal states if possible, but for milestone 4, 
            // if offline, UI needs to know
            this.state.status = 'offline';
        } else if (!offline && this.state.status === 'offline') {
            this.state.status = 'idle'; // Reset so user can start
        }
    }

    public startNewTask(taskId: string, prompt: string, modelId: string) {
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

    public addEvent(event: AgentEvent) {
        const uniqueId = `${event.taskId}-${event.eventId}`;
        if (this.seenEvents.has(uniqueId)) {
            return false; // Deduplicated
        }
        
        this.seenEvents.add(uniqueId);
        this.state.events.push(event);

        // Update projected state based on event
        if (event.type === 'change.created') {
            const ce = event as ChangeCreatedEvent;
            // Upsert change
            const existing = this.state.changes.find(c => c.path === ce.path);
            if (!existing) {
                this.state.changes.push({ path: ce.path, operation: ce.operation });
            }
        } else if (event.type === 'task.completed') {
            this.state.status = 'completed';
        } else if (event.type === 'task.failed') {
            this.state.status = 'failed';
        } else if (event.type === 'task.cancelled') {
            this.state.status = 'cancelled';
        } else if (event.type === 'tool.completed') {
            const te = event as ToolCompletedEvent;
            // If the final tool was complete, and we want to capture final output?
            // Actually agent.status or tool.completed usually contains the text.
            // For now we just keep the event list.
        }

        return true; // Added
    }

    public setFinalResponse(text: string) {
        this.state.finalResponse = text;
    }
}
