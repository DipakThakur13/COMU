"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const workspace_context_1 = require("../../workspace/workspace_context");
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
        }
        else {
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
            const ctx = await (0, workspace_context_1.getWorkspaceContext)();
            // It will return null if no workspace is opened, which is fine for the test runner if started empty.
            if (ctx !== null) {
                assert.ok(ctx.rootPath);
                assert.ok(ctx.workspaceId);
            }
        }
        catch (e) {
            assert.fail('getWorkspaceContext threw an error');
        }
    });
    // Note: Deeper E2E tests for Webview messaging, ProviderManager, and TaskSessionStore
    // are better suited for unit tests since Extension Host headless testing limits Webview inspection.
});
//# sourceMappingURL=extension.test.js.map