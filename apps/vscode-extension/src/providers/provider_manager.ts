import { SecretManager } from '../security/secrets';
import { ProviderConfig, ProviderTestResult, ProviderStatus, ProviderModel } from '@comu/protocol';
import { NvidiaProvider, NvidiaModelCatalog } from '@comu/provider-nvidia';
import { OpenAICompatibleProvider, OllamaProvider, ASTRA_CAPABILITY_PROFILE } from '@comu/model-core';

export interface ProviderDefinition {
    id: string;
    displayName: string;
    description?: string;
    isLocal?: boolean;
    defaultEndpoint?: string;
    models: ProviderModel[];
}

/** Minimal settings accessor so this module never depends on the vscode API directly (keeps it unit-testable). */
export interface ProviderSettingsReader {
    get<T>(key: string): T | undefined;
}

export class ProviderManager {
    constructor(private readonly settings: ProviderSettingsReader = { get: () => undefined }) {}

    private static readonly REGISTERED_PROVIDERS: ProviderDefinition[] = [
        {
            id: 'nvidia',
            displayName: 'NVIDIA',
            description: 'NVIDIA NIM high-performance engineering models. Bring your own NVIDIA API key.',
            defaultEndpoint: NvidiaProvider.DEFAULT_ENDPOINT,
            models: [
                {
                    id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
                    name: 'Nemotron 3.5 Lightning 30B-A3B',
                    description: 'Fast Agent',
                    contextTokens: 128000
                },
                {
                    id: 'deepseek-ai/deepseek-v4-pro-0813',
                    name: 'DeepSeek V4 Pro 0813',
                    description: 'Deep Engineering',
                    contextTokens: 128000
                },
                {
                    id: 'deepseek-ai/deepseek-v4-flash-0731',
                    name: 'DeepSeek V4 Flash 0731',
                    description: 'Fast Agent + Chat',
                    contextTokens: 128000
                },
                {
                    id: 'moonshotai/kimi-k3',
                    name: 'Kimi K3',
                    description: 'Frontier Coding',
                    contextTokens: 128000
                },
                {
                    id: 'poolside/laguna-xs-2.1',
                    name: 'Laguna XS 2.1',
                    description: 'Long-Horizon Coding',
                    contextTokens: 32768
                },
                {
                    id: 'meta/muse-glimmer-30b',
                    name: 'Muse Glimmer 30B',
                    description: 'Multimodal Specialist',
                    contextTokens: 128000
                },
                {
                    id: 'nvidia/nemotron-3-ultra-550b-a55b',
                    name: 'Nemotron 3 Ultra',
                    description: 'High compute, long-horizon engineering',
                    contextTokens: 128000
                }
            ]
        },
        {
            id: 'experiential',
            displayName: 'GPT-6 Astra (Experiential Labs)',
            description: 'Frontier reasoning and coding model with 1.05M token context window. Connect via Experiential Labs OpenAI-compatible gateway.',
            defaultEndpoint: ASTRA_CAPABILITY_PROFILE.defaultEndpoint,
            models: [
                {
                    id: 'gpt-6-astra',
                    name: 'GPT-6 Astra',
                    description: 'Frontier reasoning and coding model with 1.05M context',
                    contextTokens: 1050000
                }
            ]
        },
        {
            id: 'openai',
            displayName: 'OpenAI-Compatible',
            description: 'Connect any OpenAI-compatible API endpoint with your own API key.',
            defaultEndpoint: 'https://api.openai.com/v1',
            models: [
                { id: 'gpt-4o', name: 'GPT-4o', contextTokens: 128000 }
            ]
        },
        {
            id: 'ollama',
            displayName: 'Ollama (Local)',
            description: 'Run open-weights models locally through Ollama. No API key; nothing leaves your machine.',
            isLocal: true,
            defaultEndpoint: OllamaProvider.DEFAULT_BASE_URL,
            models: [
                { id: 'ollama:llama3.1', name: 'Llama 3.1 (Local)', description: 'Run `ollama pull llama3.1`', contextTokens: 8192 },
                { id: 'ollama:qwen2.5-coder', name: 'Qwen 2.5 Coder (Local)', description: 'Run `ollama pull qwen2.5-coder`', contextTokens: 8192 },
                { id: 'ollama:deepseek-coder-v2', name: 'DeepSeek Coder V2 (Local)', description: 'Run `ollama pull deepseek-coder-v2`', contextTokens: 8192 }
            ]
        },
        {
            id: 'anthropic',
            displayName: 'Anthropic-Compatible',
            description: 'Connect Anthropic API endpoint with your own API key.',
            defaultEndpoint: 'https://api.anthropic.com/v1',
            models: [
                { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', contextTokens: 200000 }
            ]
        }
    ];

    /** The last probe of each provider, stamped with when it finished. The only source of a status. */
    private lastChecks = new Map<string, ProviderTestResult>();
    private checking = new Set<string>();
    private providerEndpoints = new Map<string, string>();
    private cachedProvidersState: ProviderConfig[] | null = null;

    /**
     * A credential is an input, not a status. Without one there is nothing to probe; with one, the
     * status is whatever the last probe found, and UNCHECKED until something has probed it.
     */
    private statusFor(providerId: string, hasCredential: boolean): ProviderStatus {
        if (!hasCredential) return 'NOT_CONFIGURED';
        if (this.checking.has(providerId)) return 'CONNECTING';
        return this.lastChecks.get(providerId)?.status ?? 'UNCHECKED';
    }

    public getCachedProvidersState(): ProviderConfig[] {
        if (this.cachedProvidersState) {
            return this.cachedProvidersState;
        }
        return ProviderManager.REGISTERED_PROVIDERS.map(p => ({
            providerId: p.id,
            displayName: p.displayName,
            enabled: true,
            endpoint: this.providerEndpoints.get(p.id) || p.defaultEndpoint,
            selectedModel: p.models[0]?.name,
            hasCredential: p.isLocal || false,
            isLocal: p.isLocal || false,
            status: this.statusFor(p.id, p.isLocal || false),
            lastCheck: p.isLocal ? this.lastChecks.get(p.id) : undefined,
            models: p.models,
            environmentDetected: false,
            description: p.description
        }));
    }

    public async getProvidersState(forceRefresh: boolean = false): Promise<ProviderConfig[]> {
        if (!forceRefresh && this.cachedProvidersState) {
            return this.cachedProvidersState;
        }

        const secrets = SecretManager.getInstance();
        const state: ProviderConfig[] = await Promise.all(
            ProviderManager.REGISTERED_PROVIDERS.map(async (p) => {
                let hasCredential = false;
                let environmentDetected = false;

                if (p.isLocal) {
                    hasCredential = true;
                    if (p.id === 'ollama') {
                        return await this.describeOllama(p);
                    }
                } else {
                    if (p.id === 'nvidia') {
                        environmentDetected = NvidiaProvider.detectEnvironmentCredential();
                    } else if (p.id === 'experiential') {
                        environmentDetected = OpenAICompatibleProvider.detectEnvironmentCredential('experiential');
                    } else if (p.id === 'openai') {
                        environmentDetected = OpenAICompatibleProvider.detectEnvironmentCredential('openai');
                    }
                    const key = await secrets.getProviderKey(p.id);
                    hasCredential = !!key || environmentDetected;
                }

                const status = this.statusFor(p.id, hasCredential);
                const endpoint = this.providerEndpoints.get(p.id) || p.defaultEndpoint;

                return {
                    providerId: p.id,
                    displayName: p.displayName,
                    enabled: true,
                    endpoint,
                    selectedModel: p.models[0]?.name,
                    hasCredential,
                    isLocal: p.isLocal || false,
                    status,
                    lastCheck: hasCredential ? this.lastChecks.get(p.id) : undefined,
                    models: p.models,
                    environmentDetected,
                    description: p.description
                };
            })
        );

        this.cachedProvidersState = state;
        return state;
    }

    public async setProviderKey(providerId: string, key: string): Promise<void> {
        this.cachedProvidersState = null;
        const secrets = SecretManager.getInstance();
        // A probe of the old key says nothing about the new one, or about no key at all.
        this.lastChecks.delete(providerId);
        if (!key || !key.trim()) {
            await secrets.clearProviderKey(providerId);
        } else {
            await secrets.setProviderKey(providerId, key.trim());
        }
    }

    public async setProviderEndpoint(providerId: string, endpoint: string): Promise<void> {
        this.cachedProvidersState = null;
        const before = this.providerEndpoints.get(providerId);
        if (endpoint && endpoint.trim()) {
            const normalized = providerId === 'nvidia'
                ? NvidiaProvider.normalizeEndpoint(endpoint)
                : endpoint.trim();
            this.providerEndpoints.set(providerId, normalized);
        } else {
            this.providerEndpoints.delete(providerId);
        }
        // A probe of one address says nothing about another. Saving the same address keeps it.
        if (this.providerEndpoints.get(providerId) !== before) {
            this.lastChecks.delete(providerId);
        }
    }

    /**
     * Probes a provider and records the result, stamped, as the one thing its status derives from.
     * A result that probed nothing (no credential, or no test exists) is returned but not recorded.
     */
    public async testConnection(providerId: string, customKey?: string, customEndpoint?: string): Promise<ProviderTestResult> {
        this.cachedProvidersState = null;
        this.checking.add(providerId);
        try {
            const res = await this.probe(providerId, customKey, customEndpoint);
            if (res.status === 'NOT_CONFIGURED' || res.status === 'UNCHECKED') {
                return res;
            }
            const checked: ProviderTestResult = { ...res, checkedAt: new Date().toISOString() };
            this.lastChecks.set(providerId, checked);
            return checked;
        } finally {
            this.checking.delete(providerId);
            this.cachedProvidersState = null;
        }
    }

    private async probe(providerId: string, customKey?: string, customEndpoint?: string): Promise<ProviderTestResult> {
        const secrets = SecretManager.getInstance();
        let key = customKey?.trim() || await secrets.getProviderKey(providerId);

        if (providerId === 'nvidia') {
            if (!key && process.env.NVIDIA_API_KEY) {
                key = process.env.NVIDIA_API_KEY;
            }

            if (!key) {
                const res: ProviderTestResult = {
                    provider: 'nvidia',
                    status: 'NOT_CONFIGURED',
                    message: 'No NVIDIA API key configured.'
                };
                return res;
            }

            const rawEndpoint = customEndpoint?.trim() || this.providerEndpoints.get('nvidia') || NvidiaProvider.DEFAULT_ENDPOINT;
            const endpoint = NvidiaProvider.normalizeEndpoint(rawEndpoint);
            const res = await NvidiaProvider.testConnection(key, endpoint);

            // If test succeeded, persist the verified key and endpoint
            if (res.status === 'CONNECTED') {
                if (customKey && customKey.trim()) {
                    await secrets.setProviderKey('nvidia', customKey.trim());
                }
                if (customEndpoint !== undefined && customEndpoint.trim()) {
                    await this.setProviderEndpoint('nvidia', customEndpoint);
                }
            }

            return res;
        }

        if (providerId === 'experiential' || providerId === 'gpt-6-astra') {
            if (!key && process.env.EXPERIENTIAL_API_KEY) {
                key = process.env.EXPERIENTIAL_API_KEY;
            }

            if (!key) {
                const res: ProviderTestResult = {
                    provider: 'experiential',
                    status: 'NOT_CONFIGURED',
                    message: 'No Experiential Labs API key configured.'
                };
                return res;
            }

            const rawEndpoint = customEndpoint?.trim() || this.providerEndpoints.get('experiential') || ASTRA_CAPABILITY_PROFILE.defaultEndpoint;
            const res = await OpenAICompatibleProvider.testConnection(key, rawEndpoint, undefined, 'gpt-6-astra', ASTRA_CAPABILITY_PROFILE);

            if (res.status === 'CONNECTED') {
                if (customKey && customKey.trim()) {
                    await secrets.setProviderKey('experiential', customKey.trim());
                }
                if (customEndpoint !== undefined && customEndpoint.trim()) {
                    await this.setProviderEndpoint('experiential', customEndpoint);
                }
            }

            return res;
        }

        if (providerId === 'openai') {
            if (!key && process.env.OPENAI_API_KEY) {
                key = process.env.OPENAI_API_KEY;
            }

            if (!key) {
                const res: ProviderTestResult = {
                    provider: 'openai',
                    status: 'NOT_CONFIGURED',
                    message: 'No OpenAI API key configured.'
                };
                return res;
            }

            const rawEndpoint = customEndpoint?.trim() || this.providerEndpoints.get('openai') || 'https://api.openai.com/v1';
            const res = await OpenAICompatibleProvider.testConnection(key, rawEndpoint, undefined, 'gpt-4o');

            if (res.status === 'CONNECTED') {
                if (customKey && customKey.trim()) {
                    await secrets.setProviderKey('openai', customKey.trim());
                }
                if (customEndpoint !== undefined && customEndpoint.trim()) {
                    await this.setProviderEndpoint('openai', customEndpoint);
                }
            }

            return res;
        }

        if (providerId === 'ollama') {
            const endpoint = customEndpoint?.trim() || this.getOllamaEndpoint();
            const res = await OllamaProvider.probe(endpoint);
            if (res.status === 'CONNECTED' && customEndpoint !== undefined && customEndpoint.trim()) {
                await this.setProviderEndpoint('ollama', customEndpoint);
            }
            return res;
        }

        // No probe exists for this provider. Having a key proves nothing about reaching it.
        const res: ProviderTestResult = {
            provider: providerId,
            status: key ? 'UNCHECKED' : 'NOT_CONFIGURED',
            message: key
                ? 'COMU has no connection test for this provider yet, so the key has not been checked.'
                : 'No credential configured.'
        };
        return res;
    }

    public async isProviderConfigured(modelId: string): Promise<{ configured: boolean; providerId: string; message?: string }> {
        const idLower = (modelId || '').toLowerCase();
        
        if (OllamaProvider.isOllamaModelId(idLower)) {
            const probe = await OllamaProvider.probe(this.getOllamaEndpoint(), 1500);
            const configured = probe.status === 'CONNECTED';
            return {
                configured,
                providerId: 'ollama',
                message: configured ? undefined : (probe.message || 'Ollama is not reachable.')
            };
        }

        // By the catalogue, as the runtime routes: moonshotai/kimi-k3 is NVIDIA's and names no "nvidia".
        if (NvidiaModelCatalog.has(modelId)) {
            const secrets = SecretManager.getInstance();
            const key = await secrets.getProviderKey('nvidia');
            const hasEnv = NvidiaProvider.detectEnvironmentCredential();
            const configured = !!(key || hasEnv);
            return {
                configured,
                providerId: 'nvidia',
                message: configured ? undefined : 'Connect your NVIDIA API key before starting this task.'
            };
        }

        if (idLower.includes('experiential') || idLower.includes('astra')) {
            const secrets = SecretManager.getInstance();
            const key = await secrets.getProviderKey('experiential');
            const hasEnv = OpenAICompatibleProvider.detectEnvironmentCredential('experiential');
            const configured = !!(key || hasEnv);
            return {
                configured,
                providerId: 'experiential',
                message: configured ? undefined : 'Connect your Experiential Labs API key for GPT-6 Astra before starting this task.'
            };
        }

        if (idLower.includes('openai') || idLower.includes('gpt-4')) {
            const secrets = SecretManager.getInstance();
            const key = await secrets.getProviderKey('openai');
            const hasEnv = OpenAICompatibleProvider.detectEnvironmentCredential('openai');
            const configured = !!(key || hasEnv);
            return {
                configured,
                providerId: 'openai',
                message: configured ? undefined : 'Connect your OpenAI API key before starting this task.'
            };
        }

        // Generic cloud provider check
        const secrets = SecretManager.getInstance();
        const key = await secrets.getProviderKey(modelId);
        return {
            configured: !!key,
            providerId: modelId,
            message: key ? undefined : `Connect an API key for ${modelId} before starting this task.`
        };
    }

    /** Ollama endpoint precedence: saved endpoint, then the comu.ollama.endpoint setting, then OLLAMA_HOST, then the default. */
    public getOllamaEndpoint(): string {
        const saved = this.providerEndpoints.get('ollama');
        if (saved) return OllamaProvider.normalizeBaseUrl(saved);
        const configured = this.settings.get<string>('ollama.endpoint');
        return OllamaProvider.normalizeBaseUrl(configured && configured.trim() ? configured : undefined);
    }

    private async describeOllama(p: ProviderDefinition): Promise<ProviderConfig> {
        const endpoint = this.getOllamaEndpoint();
        const probe = await OllamaProvider.probe(endpoint, 1500);
        let models: ProviderModel[] = p.models;
        if (probe.status === 'CONNECTED') {
            try {
                const installed = await OllamaProvider.listModels(endpoint, 1500);
                if (installed.length > 0) {
                    models = installed.map(m => ({
                        id: m.id,
                        name: `${m.name} (Local)`,
                        description: [m.family, m.parameterSize].filter(Boolean).join(' - ') || 'Installed Ollama model',
                        contextTokens: 8192
                    }));
                }
            } catch {
                // keep suggested models
            }
        }
        const lastCheck: ProviderTestResult = { ...probe, checkedAt: new Date().toISOString() };
        this.lastChecks.set('ollama', lastCheck);
        return {
            providerId: p.id,
            displayName: p.displayName,
            enabled: true,
            endpoint,
            selectedModel: models[0]?.name,
            hasCredential: true,
            isLocal: true,
            status: probe.status,
            lastCheck,
            models,
            environmentDetected: !!(process.env.OLLAMA_HOST && process.env.OLLAMA_HOST.trim()),
            description: probe.status === 'CONNECTED' ? p.description : (probe.message || p.description)
        };
    }

    public async getRawConfig(): Promise<Record<string, any>> {
        const secrets = SecretManager.getInstance();
        const config: Record<string, any> = {};

        for (const p of ProviderManager.REGISTERED_PROVIDERS) {
            if (!p.isLocal) {
                let key = await secrets.getProviderKey(p.id);
                if (!key && p.id === 'nvidia' && process.env.NVIDIA_API_KEY) {
                    key = process.env.NVIDIA_API_KEY;
                } else if (!key && p.id === 'experiential' && process.env.EXPERIENTIAL_API_KEY) {
                    key = process.env.EXPERIENTIAL_API_KEY;
                } else if (!key && p.id === 'openai' && process.env.OPENAI_API_KEY) {
                    key = process.env.OPENAI_API_KEY;
                }
                if (key) {
                    config[p.id] = {
                        apiKey: key,
                        endpoint: this.providerEndpoints.get(p.id) || p.defaultEndpoint
                    };
                }
            } else if (p.id === 'ollama') {
                config[p.id] = { endpoint: this.getOllamaEndpoint() };
            } else {
                config[p.id] = {};
            }
        }
        return config;
    }
}
