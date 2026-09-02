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
export declare class ProviderManager {
    private static readonly SUPPORTED_PROVIDERS;
    getProvidersState(): Promise<ProviderInfo[]>;
    setProviderKey(providerId: string, key: string): Promise<void>;
    getRawConfig(): Promise<Record<string, any>>;
}
//# sourceMappingURL=provider_manager.d.ts.map