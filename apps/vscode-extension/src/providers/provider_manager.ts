import * as vscode from 'vscode';
import { SecretManager } from '../security/secrets';

export interface ProviderModel {
    id: string;
    name: string;
}

export interface ProviderInfo {
    id: string;
    displayName: string;
    configured: boolean;
    models: ProviderModel[];
    isLocal?: boolean;
}

export class ProviderManager {
    private static readonly SUPPORTED_PROVIDERS = [
        {
            id: 'nvidia',
            displayName: 'NVIDIA',
            models: [
                { id: 'nvidia-nemotron-3-ultra', name: 'Nemotron 3 Ultra' }
            ]
        },
        {
            id: 'openai',
            displayName: 'OpenAI',
            models: []
        },
        {
            id: 'anthropic',
            displayName: 'Anthropic',
            models: []
        },
        {
            id: 'ollama',
            displayName: 'Ollama',
            models: [
                { id: 'ollama-llama-3', name: 'Llama 3 (Local)' }
            ],
            isLocal: true
        }
    ];

    public async getProvidersState(): Promise<ProviderInfo[]> {
        const secrets = SecretManager.getInstance();
        const state: ProviderInfo[] = [];

        for (const p of ProviderManager.SUPPORTED_PROVIDERS) {
            let configured = false;
            if (p.isLocal) {
                configured = true;
            } else {
                const key = await secrets.getProviderKey(p.id);
                configured = !!key;
            }

            state.push({
                ...p,
                configured
            });
        }
        return state;
    }

    public async setProviderKey(providerId: string, key: string): Promise<void> {
        if (!key) {
            await SecretManager.getInstance().clearProviderKey(providerId);
        } else {
            await SecretManager.getInstance().setProviderKey(providerId, key);
        }
    }

    public async getRawConfig(): Promise<Record<string, any>> {
        const secrets = SecretManager.getInstance();
        const config: Record<string, any> = {};

        for (const p of ProviderManager.SUPPORTED_PROVIDERS) {
            if (!p.isLocal) {
                const key = await secrets.getProviderKey(p.id);
                if (key) {
                    config[p.id] = { apiKey: key };
                }
            } else {
                config[p.id] = {};
            }
        }
        return config;
    }
}
