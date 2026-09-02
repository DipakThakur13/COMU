import { AgentEvent } from '@comu/protocol';
export declare class SSEClient {
    private onEvent;
    private onError;
    private abortController;
    constructor(onEvent: (event: AgentEvent) => void, onError: (error: Error) => void);
    connect(url: string, headers: Record<string, string>): Promise<void>;
    disconnect(): void;
}
//# sourceMappingURL=sse_client.d.ts.map