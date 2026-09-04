import * as assert from 'assert';
import { ProviderManager } from '../../providers/provider_manager';
import { SecretManager } from '../../security/secrets';
import * as vscode from 'vscode';

suite('ProviderManager Test Suite', () => {
    test('Should return built-in mock and local providers', async () => {
        // Initialize with mock context
        const mockContext = {
            secrets: {
                get: async () => undefined,
                store: async () => {},
                delete: async () => {}
            }
        } as any;
        SecretManager.initialize(mockContext);

        const manager = new ProviderManager();
        const providers = await manager.getProvidersState();
        
        assert.ok(providers.length > 0);
        
        const nvidia = providers.find((p: any) => p.id === 'nvidia');
        assert.ok(nvidia, 'NVIDIA provider should be registered');
        assert.strictEqual(nvidia?.isLocal, undefined);
    });
});
