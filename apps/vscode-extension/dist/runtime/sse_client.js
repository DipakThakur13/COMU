"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SSEClient = void 0;
const eventsource_parser_1 = require("eventsource-parser");
class SSEClient {
    onEvent;
    onError;
    abortController = null;
    constructor(onEvent, onError) {
        this.onEvent = onEvent;
        this.onError = onError;
    }
    async connect(url, headers) {
        this.disconnect();
        this.abortController = new AbortController();
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
            const parser = (0, eventsource_parser_1.createParser)({
                onEvent: (event) => {
                    try {
                        const parsedData = JSON.parse(event.data);
                        this.onEvent(parsedData);
                    }
                    catch (err) {
                        console.error('Failed to parse SSE event data', err);
                    }
                }
            });
            // Node fetch response.body is an async iterable or a web stream
            // If it's a web stream (Node 18+ fetch), we use getReader()
            const body = response.body;
            if (body.getReader) {
                const reader = body.getReader();
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    parser.feed(decoder.decode(value, { stream: true }));
                }
            }
            else {
                // Node native stream fallback
                for await (const chunk of body) {
                    parser.feed(chunk.toString());
                }
            }
        }
        catch (err) {
            if (err.name === 'AbortError') {
                return;
            }
            this.onError(err);
        }
    }
    disconnect() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}
exports.SSEClient = SSEClient;
//# sourceMappingURL=sse_client.js.map