import * as vscode from 'vscode';
export declare class SecretManager {
    private static instance;
    private secretStorage;
    private constructor();
    static initialize(context: vscode.ExtensionContext): void;
    static getInstance(): SecretManager;
    private getSecretName;
    getProviderKey(providerId: string): Promise<string | undefined>;
    setProviderKey(providerId: string, key: string): Promise<void>;
    clearProviderKey(providerId: string): Promise<void>;
}
//# sourceMappingURL=secrets.d.ts.map