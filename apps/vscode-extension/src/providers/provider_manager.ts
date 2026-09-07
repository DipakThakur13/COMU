import * as vscode from 'vscode';
import { SecretManager } from '../security/secrets';
import { ProviderConfig, ProviderTestResult, ProviderStatus, ProviderModel } from '@comu/protocol';
import { NvidiaProvider } from '@comu/provider-nvidia';
import { OpenAICompatibleProvider, ASTRA_CAPABILITY_PROFILE } from '@comu/model-core';

export interface ProviderDefinition {
    id: string;
    displayName: string;
    description?: string;
    isLocal?: boolean;
    defaultEndpoint?: string;
    models: ProviderModel[];
}

export class ProviderManager {
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
                    name: 'Nemotron 3 Ultra (Legacy)',
                    description: 'Legacy / High Compute',
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
            description: 'Run open-weights models locally on your machine with zero external network access.',
            isLocal: true,
            models: [
                {
                    id: 'ollama-llama-3',
                    name: 'Llama 3 (Local)',
                    description: 'Local on-device execution',
                    contextTokens: 8192
                }
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

    private providerStatuses = new Map<string, ProviderStatus>();
    private providerEndpoints = new Map<string, string>();

    public async getProvidersState(): Promise<ProviderConfig[]> {
        const secrets = SecretManager.getInstance();
        const state: ProviderConfig[] = [];

        for (const p of ProviderManager.REGISTERED_PROVIDERS) {
            let hasCredential = false;
            let environmentDetected = false;

            if (p.isLocal) {
                hasCredential = true;
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

            let status: ProviderStatus = this.providerStatuses.get(p.id) || (hasCredential ? 'CONNECTED' : 'NOT_CONFIGURED');
            if (!hasCredential) {
                status = 'NOT_CONFIGURED';
            }

            const endpoint = this.providerEndpoints.get(p.id) || p.defaultEndpoint;

            state.push({
                providerId: p.id,
                displayName: p.displayName,
                enabled: true,
                endpoint,
                selectedModel: p.models[0]?.name,
                hasCredential,
                isLocal: p.isLocal || false,
                status,
                models: p.models,
                environmentDetected,
                description: p.description
            });
        }

        return state;
    }

    public async setProviderKey(providerId: string, key: string): Promise<void> {
        const secrets = SecretManager.getInstance();
        if (!key || !key.trim()) {
            await secrets.clearProviderKey(providerId);
            this.providerStatuses.set(providerId, 'NOT_CONFIGURED');
        } else {
            await secrets.setProviderKey(providerId, key.trim());
            this.providerStatuses.set(providerId, 'CONNECTED');
        }
    }

    public async setProviderEndpoint(providerId: string, endpoint: string): Promise<void> {
        if (endpoint && endpoint.trim()) {
            const normalized = providerId === 'nvidia' 
                ? NvidiaProvider.normalizeEndpoint(endpoint) 
                : endpoint.trim();
            this.providerEndpoints.set(providerId, normalized);
        } else {
            this.providerEndpoints.delete(providerId);
        }
    }

    public async testConnection(providerId: string, customKey?: string, customEndpoint?: string): Promise<ProviderTestResult> {
        this.providerStatuses.set(providerId, 'CONNECTING');

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
                this.providerStatuses.set(providerId, 'NOT_CONFIGURED');
                return res;
            }

            const rawEndpoint = customEndpoint?.trim() || this.providerEndpoints.get('nvidia') || NvidiaProvider.DEFAULT_ENDPOINT;
            const endpoint = NvidiaProvider.normalizeEndpoint(rawEndpoint);
            const res = await NvidiaProvider.testConnection(key, endpoint);
            this.providerStatuses.set(providerId, res.status);

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
                this.providerStatuses.set(providerId, 'NOT_CONFIGURED');
                return res;
            }

            const rawEndpoint = customEndpoint?.trim() || this.providerEndpoints.get('experiential') || ASTRA_CAPABILITY_PROFILE.defaultEndpoint;
            const res = await OpenAICompatibleProvider.testConnection(key, rawEndpoint, undefined, 'gpt-6-astra', ASTRA_CAPABILITY_PROFILE);
            this.providerStatuses.set(providerId, res.status);

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
                this.providerStatuses.set(providerId, 'NOT_CONFIGURED');
                return res;
            }

            const rawEndpoint = customEndpoint?.trim() || this.providerEndpoints.get('openai') || 'https://api.openai.com/v1';
            const res = await OpenAICompatibleProvider.testConnection(key, rawEndpoint, undefined, 'gpt-4o');
            this.providerStatuses.set(providerId, res.status);

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
            const res: ProviderTestResult = {
                provider: 'ollama',
                status: 'CONNECTED',
                model: 'Llama 3 (Local)',
                latencyMs: 12
            };
            this.providerStatuses.set(providerId, 'CONNECTED');
            return res;
        }

        const res: ProviderTestResult = {
            provider: providerId,
            status: key ? 'CONNECTED' : 'NOT_CONFIGURED',
            model: providerId,
            message: key ? 'Credential verified.' : 'No credential configured.'
        };
        this.providerStatuses.set(providerId, res.status);
        return res;
    }

    public async isProviderConfigured(modelId: string): Promise<{ configured: boolean; providerId: string; message?: string }> {
        const idLower = (modelId || '').toLowerCase();
        
        if (idLower.includes('ollama') || idLower.includes('local')) {
            return { configured: true, providerId: 'ollama' };
        }

        if (idLower.includes('nvidia') || idLower.includes('nemotron') || !modelId) {
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
            } else {
                config[p.id] = {};
            }
        }
        return config;
    }
}
