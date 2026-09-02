import { AgentEvent } from "@comu/protocol";
export interface ChangeSummary {
    path: string;
    operation: "CREATE" | "MODIFY";
}
export type WebviewMessage = {
    type: "ready";
} | {
    type: "submit_prompt";
    prompt: string;
    modelId: string;
} | {
    type: "cancel_task";
} | {
    type: "request_diff";
    path: string;
} | {
    type: "select_model";
    modelId: string;
} | {
    type: "save_provider_key";
    providerId: string;
    key: string;
} | {
    type: "remove_provider_key";
    providerId: string;
} | {
    type: "test_provider";
    providerId: string;
} | {
    type: "request_providers";
};
export type ExtensionMessage = {
    type: "state_update";
    state: ChatSessionStateUI;
} | {
    type: "error";
    message: string;
} | {
    type: "providers_update";
    providers: any[];
} | {
    type: "agent_event";
    event: AgentEvent;
};
export interface ChatSessionStateUI {
    taskId?: string;
    prompt?: string;
    modelId?: string;
    status: "idle" | "running" | "completed" | "failed" | "cancelled" | "offline";
    events: AgentEvent[];
    changes: ChangeSummary[];
    finalResponse?: string;
}
//# sourceMappingURL=messages.d.ts.map