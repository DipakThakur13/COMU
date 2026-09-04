import * as assert from 'assert';
import * as vscode from 'vscode';
import { getWorkspaceContext } from '../../workspace/workspace_context';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('comu.comu-ai'));
    });

    test('Should activate extension', async () => {
        const ext = vscode.extensions.getExtension('comu.comu-ai');
        if (ext) {
            await ext.activate();
            assert.ok(ext.isActive);
        } else {
            assert.fail('Extension not found');
        }
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('comu.openChat'));
    });

    test('Workspace Context Extraction', async () => {
        // Since we are running in an empty or arbitrary workspace depending on test runner config
        // this is a basic sanity check that it doesn't throw.
        try {
            const ctx = await getWorkspaceContext();
            // It will return null if no workspace is opened, which is fine for the test runner if started empty.
            if (ctx !== null) {
                assert.ok(ctx.rootPath);
                assert.ok(ctx.workspaceId);
            }
        } catch (e) {
            assert.fail('getWorkspaceContext threw an error');
        }
    });

    // Note: Deeper E2E tests for Webview messaging, ProviderManager, and TaskSessionStore
    // are better suited for unit tests since Extension Host headless testing limits Webview inspection.
});
