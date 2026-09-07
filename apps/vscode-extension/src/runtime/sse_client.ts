import { AgentEvent } from '@comu/protocol';
import { createParser, EventSourceMessage } from 'eventsource-parser';

export class SSEClient {
    private abortController: AbortController | null = null;
    
    constructor(private onEvent: (event: AgentEvent) => void, private onError: (error: Error) => void) {}

    public async connect(url: string, headers: Record<string, string>): Promise<void> {
        this.disconnect();
        this.abortController = new AbortController();

        const t10 = Date.now();
        console.log('[COMU SSE] T10: SSE connection started');
        let firstEventReceived = false;

        try {
            const response = await fetch(url, {
                headers,
                signal: this.abortController.signal
            });

            if (!response.ok) {
                throw new Error(`SSE connection failed: ${response.status}`);
            }

            if (!response.body) {
                throw new Error(`No response body`);
            }

            const parser = createParser({
                onEvent: (event: EventSourceMessage) => {
                    try {
                        const parsedData = JSON.parse(event.data) as AgentEvent;
                        if (!firstEventReceived) {
                            firstEventReceived = true;
                            const t11 = Date.now();
                            console.log(`[COMU SSE] T11: SSE first event received in ${t11 - t10}ms`);
                        }
                        this.onEvent(parsedData);
                    } catch (err) {
                        console.error('Failed to parse SSE event data', err);
                    }
                }
            });

            // Node fetch response.body is an async iterable or a web stream
            // If it's a web stream (Node 18+ fetch), we use getReader()
            const body = response.body as any;
            if (body.getReader) {
                const reader = body.getReader();
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    parser.feed(decoder.decode(value, { stream: true }));
                }
            } else {
                // Node native stream fallback
                for await (const chunk of body) {
                    parser.feed(chunk.toString());
                }
            }

        } catch (err: any) {
            if (err.name === 'AbortError') {
                return;
            }
            this.onError(err);
        }
    }

    public disconnect() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}
