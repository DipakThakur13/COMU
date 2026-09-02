import { ModelProvider, ModelCapabilities, ModelRequest, ModelResponse } from '@comu/model-core';

declare class NvidiaProvider implements ModelProvider {
    id: string;
    name: string;
    private apiKey;
    private endpoint;
    constructor(apiKey: string);
    getCapabilities(): ModelCapabilities;
    private mapMessages;
    private mapTools;
    generate(request: ModelRequest): Promise<ModelResponse>;
}

export { NvidiaProvider };
