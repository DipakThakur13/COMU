"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecretManager = void 0;
class SecretManager {
    static instance;
    secretStorage;
    constructor(context) {
        this.secretStorage = context.secrets;
    }
    static initialize(context) {
        if (!SecretManager.instance) {
            SecretManager.instance = new SecretManager(context);
        }
    }
    static getInstance() {
        if (!SecretManager.instance) {
            throw new Error("SecretManager not initialized");
        }
        return SecretManager.instance;
    }
    getSecretName(providerId) {
        return `comu.provider.${providerId}.apiKey`;
    }
    async getProviderKey(providerId) {
        return this.secretStorage.get(this.getSecretName(providerId));
    }
    async setProviderKey(providerId, key) {
        await this.secretStorage.store(this.getSecretName(providerId), key);
    }
    async clearProviderKey(providerId) {
        await this.secretStorage.delete(this.getSecretName(providerId));
    }
}
exports.SecretManager = SecretManager;
//# sourceMappingURL=secrets.js.map