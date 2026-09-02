import { AgentEvent } from '@comu/protocol';
import { ChatSessionStateUI } from '../protocol/messages';
export declare class TaskSessionStore {
    private state;
    private seenEvents;
    getState(): ChatSessionStateUI;
    setOffline(offline: boolean): void;
    startNewTask(taskId: string, prompt: string, modelId: string): void;
    addEvent(event: AgentEvent): boolean;
    setFinalResponse(text: string): void;
}
//# sourceMappingURL=task_session_store.d.ts.map