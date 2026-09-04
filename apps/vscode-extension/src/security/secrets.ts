import * as vscode from 'vscode';

export class SecretManager {
    private static instance: SecretManager;
    private secretStorage: vscode.SecretStorage;

    private constructor(context: vscode.ExtensionContext) {
        this.secretStorage = context.secrets;
    }

    public static initialize(context: vscode.ExtensionContext) {
        if (!SecretManager.instance) {
            SecretManager.instance = new SecretManager(context);
        }
    }

    public static getInstance(): SecretManager {
        if (!SecretManager.instance) {
            throw new Error("SecretManager not initialized");
        }
        return SecretManager.instance;
    }

    private getSecretName(providerId: string): string {
        return `comu.provider.${providerId}.apiKey`;
    }

    public async getProviderKey(providerId: string): Promise<string | undefined> {
        return this.secretStorage.get(this.getSecretName(providerId));
    }

    public async setProviderKey(providerId: string, key: string): Promise<void> {
        await this.secretStorage.store(this.getSecretName(providerId), key);
    }

    public async clearProviderKey(providerId: string): Promise<void> {
        await this.secretStorage.delete(this.getSecretName(providerId));
    }
}
