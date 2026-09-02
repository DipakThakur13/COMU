"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderManager = void 0;
const secrets_1 = require("../security/secrets");
class ProviderManager {
    static SUPPORTED_PROVIDERS = [
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
    async getProvidersState() {
        const secrets = secrets_1.SecretManager.getInstance();
        const state = [];
        for (const p of ProviderManager.SUPPORTED_PROVIDERS) {
            let configured = false;
            if (p.isLocal) {
                configured = true;
            }
            else {
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
    async setProviderKey(providerId, key) {
        if (!key) {
            await secrets_1.SecretManager.getInstance().clearProviderKey(providerId);
        }
        else {
            await secrets_1.SecretManager.getInstance().setProviderKey(providerId, key);
        }
    }
    async getRawConfig() {
        const secrets = secrets_1.SecretManager.getInstance();
        const config = {};
        for (const p of ProviderManager.SUPPORTED_PROVIDERS) {
            if (!p.isLocal) {
                const key = await secrets.getProviderKey(p.id);
                if (key) {
                    config[p.id] = { apiKey: key };
                }
            }
            else {
                config[p.id] = {};
            }
        }
        return config;
    }
}
exports.ProviderManager = ProviderManager;
//# sourceMappingURL=provider_manager.js.map