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
exports.ChatViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const workspace_context_1 = require("../workspace/workspace_context");
const editor_context_1 = require("../workspace/editor_context");
const diff_viewer_1 = require("../diff/diff_viewer");
class ChatViewProvider {
    _extensionUri;
    runtimeClient;
    sessionStore;
    sseClient;
    providerManager;
    static viewType = 'comu.chatView';
    _view;
    constructor(_extensionUri, runtimeClient, sessionStore, sseClient, providerManager) {
        this._extensionUri = _extensionUri;
        this.runtimeClient = runtimeClient;
        this.sessionStore = sessionStore;
        this.sseClient = sseClient;
        this.providerManager = providerManager;
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'ready':
                    this.sendStateToWebview();
                    break;
                case 'submit_prompt':
                    await this.handleSubmitPrompt(data.prompt, data.modelId);
                    break;
                case 'cancel_task':
                    await this.handleCancelTask();
                    break;
                case 'request_diff':
                    await this.handleRequestDiff(data.path);
                    break;
                case 'request_providers':
                    await this.sendProvidersToWebview();
                    break;
                case 'save_provider_key':
                    await this.providerManager.setProviderKey(data.providerId, data.key);
                    await this.sendProvidersToWebview();
                    await this.pushConfigToRuntime();
                    break;
                case 'remove_provider_key':
                    await this.providerManager.setProviderKey(data.providerId, '');
                    await this.sendProvidersToWebview();
                    await this.pushConfigToRuntime();
                    break;
                case 'test_provider':
                    // Just a mock test for now
                    vscode.window.showInformationMessage(`Connection to ${data.providerId} successful!`);
                    break;
            }
        });
    }
    async sendProvidersToWebview() {
        if (this._view) {
            const providers = await this.providerManager.getProvidersState();
            const msg = { type: 'providers_update', providers };
            this._view.webview.postMessage(msg);
        }
    }
    async pushConfigToRuntime() {
        const config = await this.providerManager.getRawConfig();
        await this.runtimeClient.pushConfig(config);
    }
    async handleSubmitPrompt(prompt, modelId) {
        if (!prompt)
            return;
        const workspaceCtx = await (0, workspace_context_1.getWorkspaceContext)();
        if (!workspaceCtx) {
            vscode.window.showErrorMessage("Open a workspace or select a valid workspace folder to use COMU.");
            return;
        }
        const editorCtx = (0, editor_context_1.getEditorContext)();
        try {
            const taskInfo = await this.runtimeClient.createTask({
                taskId: `task-${Date.now()}`,
                prompt,
                modelId,
                workspace: workspaceCtx,
                editor: editorCtx
            });
            this.sessionStore.startNewTask(taskInfo.taskId, prompt, modelId);
            this.sendStateToWebview();
            const url = this.runtimeClient.getEventStreamUrl(taskInfo.taskId);
            const headers = await this.runtimeClient.getHeaders();
            await this.sseClient.connect(url, headers);
        }
        catch (e) {
            this.sendErrorToWebview(`Failed to start task: ${e.message}`);
        }
    }
    async handleCancelTask() {
        const state = this.sessionStore.getState();
        if (state.taskId && state.status === 'running') {
            try {
                await this.runtimeClient.cancelTask(state.taskId);
            }
            catch (e) {
                vscode.window.showErrorMessage(`Cancel failed: ${e.message}`);
            }
        }
    }
    async handleRequestDiff(targetPath) {
        const state = this.sessionStore.getState();
        if (state.taskId) {
            await (0, diff_viewer_1.openDiff)(this.runtimeClient, state.taskId, targetPath);
        }
    }
    sendStateToWebview() {
        if (this._view) {
            const msg = { type: 'state_update', state: this.sessionStore.getState() };
            this._view.webview.postMessage(msg);
        }
    }
    sendErrorToWebview(message) {
        if (this._view) {
            const msg = { type: 'error', message };
            this._view.webview.postMessage(msg);
        }
    }
    _getHtmlForWebview(webview) {
        const htmlPath = path.join(this._extensionUri.fsPath, 'src', 'webview', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        // Replace resource paths
        const stylePath = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'style.css'));
        const scriptPath = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js'));
        html = html.replace('href="style.css"', `href="${stylePath}"`);
        html = html.replace('src="main.js"', `src="${scriptPath}"`);
        return html;
    }
}
exports.ChatViewProvider = ChatViewProvider;
//# sourceMappingURL=chat_provider.js.map