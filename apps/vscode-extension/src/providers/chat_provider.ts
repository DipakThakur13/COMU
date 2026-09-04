import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { WebviewMessage, ExtensionMessage, ChatSessionStateUI } from '../protocol/messages';
import { RuntimeClient } from '../runtime/runtime_client';
import { SSEClient } from '../runtime/sse_client';
import { TaskSessionStore } from '../sessions/task_session_store';
import { getWorkspaceContext } from '../workspace/workspace_context';
import { getEditorContext } from '../workspace/editor_context';
import { openDiff } from '../diff/diff_viewer';
import { ProviderManager } from './provider_manager';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'comu.chatView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly runtimeClient: RuntimeClient,
        private readonly sessionStore: TaskSessionStore,
        private readonly sseClient: SSEClient,
        private readonly providerManager: ProviderManager
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
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

    public async sendProvidersToWebview() {
        if (this._view) {
            const providers = await this.providerManager.getProvidersState();
            const msg: ExtensionMessage = { type: 'providers_update', providers };
            this._view.webview.postMessage(msg);
        }
    }

    private async pushConfigToRuntime() {
        const config = await this.providerManager.getRawConfig();
        await this.runtimeClient.pushConfig(config);
    }

    private async handleSubmitPrompt(prompt: string, modelId: string) {
        if (!prompt) return;

        const workspaceCtx = await getWorkspaceContext();
        if (!workspaceCtx) {
            vscode.window.showErrorMessage("Open a workspace or select a valid workspace folder to use COMU.");
            return;
        }

        const editorCtx = getEditorContext();

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
            
        } catch (e: any) {
            this.sendErrorToWebview(`Failed to start task: ${e.message}`);
        }
    }

    private async handleCancelTask() {
        const state = this.sessionStore.getState();
        if (state.taskId && state.status === 'running') {
            try {
                await this.runtimeClient.cancelTask(state.taskId);
            } catch (e: any) {
                vscode.window.showErrorMessage(`Cancel failed: ${e.message}`);
            }
        }
    }

    private async handleRequestDiff(targetPath: string) {
        const state = this.sessionStore.getState();
        if (state.taskId) {
            await openDiff(this.runtimeClient, state.taskId, targetPath);
        }
    }

    public sendStateToWebview() {
        if (this._view) {
            const msg: ExtensionMessage = { type: 'state_update', state: this.sessionStore.getState() };
            this._view.webview.postMessage(msg);
        }
    }

    public sendErrorToWebview(message: string) {
        if (this._view) {
            const msg: ExtensionMessage = { type: 'error', message };
            this._view.webview.postMessage(msg);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
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
