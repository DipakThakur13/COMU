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

        try {
            webviewView.webview.options = {
                enableScripts: true,
                localResourceRoots: [
                    this._extensionUri,
                    vscode.Uri.joinPath(this._extensionUri, 'src', 'webview')
                ]
            };

            webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        } catch (err: any) {
            console.error('[COMU ChatViewProvider] Error initializing webview HTML:', err);
            webviewView.webview.html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="padding:16px; font-family:sans-serif; color:var(--vscode-editor-foreground, #ccc); background:var(--vscode-editor-background, #1e1e1e);">
    <h3 style="color:var(--vscode-errorForeground, #f48771);">COMU AI Initialization Error</h3>
    <p>Failed to load the webview interface.</p>
    <pre style="background:rgba(0,0,0,0.3); padding:8px; border-radius:4px; overflow:auto;">${err?.stack || err?.message || err}</pre>
</body>
</html>`;
        }

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
                    if (data.endpoint !== undefined) {
                        await this.providerManager.setProviderEndpoint(data.providerId, data.endpoint);
                    }
                    await this.sendProvidersToWebview();
                    await this.pushConfigToRuntime();
                    vscode.window.showInformationMessage(`API key for ${data.providerId} saved securely.`);
                    break;
                case 'remove_provider_key':
                    await this.providerManager.setProviderKey(data.providerId, '');
                    await this.sendProvidersToWebview();
                    await this.pushConfigToRuntime();
                    vscode.window.showInformationMessage(`API key for ${data.providerId} removed.`);
                    break;
                case 'test_provider': {
                    const result = await this.providerManager.testConnection(data.providerId);
                    if (this._view) {
                        const msg: ExtensionMessage = {
                            type: 'provider_test_result',
                            providerId: data.providerId,
                            result
                        };
                        this._view.webview.postMessage(msg);
                    }
                    if (result.status === 'CONNECTED') {
                        vscode.window.showInformationMessage(`Connection to ${data.providerId} successful!${result.latencyMs ? ` (${result.latencyMs}ms)` : ''}`);
                    } else {
                        vscode.window.showErrorMessage(`Connection test failed for ${data.providerId}: ${result.message || 'Unknown error'}`);
                    }
                    break;
                }
                case 'open_settings':
                    this.openSettings(data.targetProviderId);
                    break;
                case 'respond_interaction':
                    try {
                        await this.runtimeClient.respondInteraction(data.taskId, data.interactionId, data.response);
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to respond to interaction: ${e.message}`);
                    }
                    break;
            }
        });
    }

    public openSettings(targetProviderId?: string) {
        if (this._view) {
            const msg: ExtensionMessage = { type: 'open_settings', targetProviderId };
            this._view.webview.postMessage(msg);
        }
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

        // Task-Start Guard: Verify provider configuration before proceeding
        const check = await this.providerManager.isProviderConfigured(modelId);
        if (!check.configured) {
            const errMsg = check.message || `Provider for model "${modelId}" is not configured. Please add your API key in Settings.`;
            this.sendErrorToWebview(errMsg);
            this.openSettings(check.providerId);
            vscode.window.showWarningMessage(`${errMsg} Please configure it in Provider Settings.`, 'Open Settings').then(selection => {
                if (selection === 'Open Settings') {
                    this.openSettings(check.providerId);
                }
            });
            return;
        }

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
        const candidatePaths = [
            path.join(this._extensionUri.fsPath, 'src', 'webview', 'index.html'),
            path.join(this._extensionUri.fsPath, 'dist', 'webview', 'index.html'),
            path.join(this._extensionUri.fsPath, 'webview', 'index.html')
        ];

        let htmlPath = candidatePaths.find(p => fs.existsSync(p));
        if (!htmlPath) {
            htmlPath = candidatePaths[0];
        }

        let html = fs.readFileSync(htmlPath, 'utf8');

        // Replace resource paths
        const webviewDir = path.dirname(htmlPath);
        const styleUri = fs.existsSync(path.join(webviewDir, 'style.css'))
            ? vscode.Uri.file(path.join(webviewDir, 'style.css'))
            : vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'style.css');
        const scriptUri = fs.existsSync(path.join(webviewDir, 'main.js'))
            ? vscode.Uri.file(path.join(webviewDir, 'main.js'))
            : vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js');

        const stylePath = webview.asWebviewUri(styleUri);
        const scriptPath = webview.asWebviewUri(scriptUri);

        html = html.replace('href="style.css"', `href="${stylePath}"`);
        html = html.replace('src="main.js"', `src="${scriptPath}"`);

        // Inject dynamic CSP with webview.cspSource
        const csp = `default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; connect-src ${webview.cspSource} http: https: ws:;`;
        html = html.replace(
            /<meta http-equiv="Content-Security-Policy"[^>]*>/i,
            `<meta http-equiv="Content-Security-Policy" content="${csp}">`
        );
        
        return html;
    }
}
