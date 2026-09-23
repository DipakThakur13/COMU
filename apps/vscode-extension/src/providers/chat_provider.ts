import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { WebviewMessage, ExtensionMessage } from '../protocol/messages';
import { TaskAutonomy, TASK_AUTONOMY_LEVELS } from '@comu/protocol';
import { RuntimeClient } from '../runtime/runtime_client';
import { SSEClient } from '../runtime/sse_client';
import { TaskSessionStore } from '../sessions/task_session_store';
import { getWorkspaceContext } from '../workspace/workspace_context';
import { getEditorContext } from '../workspace/editor_context';
import { openDiff } from '../diff/diff_viewer';
import { ProviderManager } from './provider_manager';
import { ReplicaPublisher } from '../sessions/replica_publisher';
import { buildReactWebviewHtml } from '../webview/react_host';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'comu.chatView';
    private _view?: vscode.WebviewView;
    /** Authoritative session state for the React interface. Idle while the flag is off. */
    private readonly replica = new ReplicaPublisher();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly runtimeClient: RuntimeClient,
        private readonly sessionStore: TaskSessionStore,
        private readonly sseClient: SSEClient,
        private readonly providerManager: ProviderManager
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        const t0 = Date.now();
        console.log('[COMU STARTUP] T0: WebView constructor/provider created');
        this._view = webviewView;

        webviewView.onDidDispose(() => {
            console.log('[COMU WEBVIEW] Webview disposed, cleaning up references');
            this._view = undefined;
            this.replica.attach(undefined);
        });

        try {
            webviewView.webview.options = {
                enableScripts: true,
                // Only the built bundle. The panel loads nothing from source and nothing remote.
                localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview')]
            };

            webviewView.webview.html = buildReactWebviewHtml(webviewView.webview, this._extensionUri);
            this.replica.attach(webviewView.webview);
            const t1 = Date.now();
            console.log(`[COMU WEBVIEW] T1: HTML returned in ${t1 - t0}ms`);
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

        // Settings and providers go out immediately; session state reaches the panel through the
        // replica, which the panel asks for as soon as it is ready.
        this.sendSettingsToWebview();
        this.sendProvidersToWebview().catch(() => {});

        webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
            switch (data.type) {
                case 'ready':
                case 'webview_ready':
                    console.log('[COMU STARTUP] T7: Extension Host ready signal received from webview');
                    this.sendSettingsToWebview();
                    this.sendProvidersToWebview().catch(() => {});
                    break;
                case 'telemetry_metric':
                    console.log(`[COMU WEBVIEW] Telemetry metric: ${data.name} = ${data.value}ms ${data.details ? '(' + data.details + ')' : ''}`);
                    break;
                case 'submit_prompt':
                    await this.handleSubmitPrompt(data.prompt, data.modelId, data.mode, data.autonomy);
                    break;
                case 'cancel_task':
                    await this.handleCancelTask();
                    break;
                case 'request_diff':
                    await this.handleRequestDiff(data.path);
                    break;
                case 'open_file':
                    await this.handleOpenFile(data.path, data.line);
                    break;
                case 'save_code':
                    await this.handleSaveCode(data.content, data.suggestedPath);
                    break;
                case 'request_providers':
                    await this.sendProvidersToWebview();
                    break;
                case 'request_snapshot':
                    // The replica detected a gap (or is starting) and needs the authoritative state.
                    this.replica.sendSnapshot();
                    break;
                case 'set_autonomy':
                    await vscode.workspace
                        .getConfiguration('comu')
                        .update('defaultAutonomy', data.autonomy, vscode.ConfigurationTarget.Global);
                    break;
                case 'save_provider_key':
                    if (data.key && data.key.trim()) {
                        await this.providerManager.setProviderKey(data.providerId, data.key);
                    }
                    if (data.endpoint !== undefined) {
                        await this.providerManager.setProviderEndpoint(data.providerId, data.endpoint);
                    }
                    await this.sendProvidersToWebview();
                    await this.pushConfigToRuntime();
                    void vscode.window.showInformationMessage(`Configuration for ${data.providerId} saved.`);
                    break;
                case 'remove_provider_key':
                    await this.providerManager.setProviderKey(data.providerId, '');
                    await this.sendProvidersToWebview();
                    await this.pushConfigToRuntime();
                    void vscode.window.showInformationMessage(`API key for ${data.providerId} removed.`);
                    break;
                case 'test_provider': {
                    const result = await this.providerManager.testConnection(data.providerId, data.key, data.endpoint);
                    if (this._view) {
                        const msg: ExtensionMessage = {
                            type: 'provider_test_result',
                            providerId: data.providerId,
                            result
                        };
                        void this._view.webview.postMessage(msg);
                    }
                    // Every outcome changes the badge, not only success: a failed probe left the
                    // card showing the status from before the test beside the failure it just reported.
                    await this.sendProvidersToWebview();
                    if (result.status === 'CONNECTED') {
                        void vscode.window.showInformationMessage(`Connection to ${data.providerId} successful!${result.latencyMs ? ` (${result.latencyMs}ms)` : ''}`);
                        await this.pushConfigToRuntime();
                    } else if (result.status === 'UNCHECKED') {
                        void vscode.window.showInformationMessage(result.message || `No connection test exists for ${data.providerId}.`);
                    } else {
                        void vscode.window.showErrorMessage(`Connection test failed for ${data.providerId}: ${result.message || 'Unknown error'}`);
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
                        void vscode.window.showErrorMessage(`Failed to respond to interaction: ${e.message}`);
                    }
                    break;
            }
        });
    }

    public openSettings(targetProviderId?: string) {
        if (this._view) {
            const msg: ExtensionMessage = { type: 'open_settings', targetProviderId };
            void this._view.webview.postMessage(msg);
        }
    }

    public async sendProvidersToWebview(forceRefresh: boolean = false) {
        if (this._view) {
            // Fast-path: immediately send cached provider catalog for zero-delay UI rendering
            const cached = this.providerManager.getCachedProvidersState();
            if (cached && cached.length > 0) {
                void this._view.webview.postMessage({ type: 'providers_update', providers: cached });
            }
            // Asynchronously resolve credentials without blocking first paint
            const providers = await this.providerManager.getProvidersState(forceRefresh);
            if (this._view) {
                const msg: ExtensionMessage = { type: 'providers_update', providers };
                void this._view.webview.postMessage(msg);
            }
        }
    }

    private async pushConfigToRuntime() {
        const config = await this.providerManager.getRawConfig();
        await this.runtimeClient.pushConfig(config);
    }

    /**
     * Single entry point for a runtime event. The session store still projects state for the diff
     * viewer and the tests; the replica is what the panel actually renders from.
     */
    public handleAgentEvent(event: any): boolean {
        const added = this.sessionStore.addEvent(event);
        if (added) {
            this.replica.publish(event);
        }
        return added;
    }

    public setConnectionState(connected: boolean) {
        this.replica.setConnection(connected ? 'online' : 'offline');
    }

    public dispose() {
        this.replica.dispose();
    }

    /** The user's default autonomy from settings, validated. */
    public getDefaultAutonomy(): TaskAutonomy {
        const configured = String(vscode.workspace.getConfiguration('comu').get<string>('defaultAutonomy') || 'ask').toLowerCase();
        return (TASK_AUTONOMY_LEVELS as readonly string[]).includes(configured) ? (configured as TaskAutonomy) : 'ask';
    }

    private sendSettingsToWebview() {
        if (this._view) {
            const msg: ExtensionMessage = {
                type: 'settings_update',
                defaultAutonomy: this.getDefaultAutonomy(),
                defaultModelId: vscode.workspace.getConfiguration('comu').get<string>('defaultModel')
            };
            void this._view.webview.postMessage(msg);
        }
    }

    private async handleSubmitPrompt(prompt: string, modelId: string, mode?: "AUTO" | "CHAT" | "ASK" | "PLAN" | "AGENT", autonomy?: TaskAutonomy) {
        if (!prompt) return;
        // The runtime refuses a task without a model rather than choosing one; say so before asking it.
        if (!modelId) {
            this.sendErrorToWebview('Choose a model in the composer before starting a task.');
            return;
        }
        const effectiveAutonomy: TaskAutonomy = autonomy && (TASK_AUTONOMY_LEVELS as readonly string[]).includes(autonomy)
            ? autonomy
            : this.getDefaultAutonomy();

        // Task-Start Guard: Verify provider configuration before proceeding
        const check = await this.providerManager.isProviderConfigured(modelId);
        if (!check.configured) {
            const errMsg = check.message || `Provider for model "${modelId}" is not configured. Please add your API key in Settings.`;
            this.sendErrorToWebview(errMsg);
            this.openSettings(check.providerId);
            void vscode.window.showWarningMessage(`${errMsg} Please configure it in Provider Settings.`, 'Open Settings').then(selection => {
                if (selection === 'Open Settings') {
                    this.openSettings(check.providerId);
                }
            });
            return;
        }

        const workspaceCtx = await getWorkspaceContext();
        if (!workspaceCtx) {
            void vscode.window.showErrorMessage("Open a workspace or select a valid workspace folder to use COMU.");
            return;
        }

        const editorCtx = getEditorContext();

        try {
            const taskInfo = await this.runtimeClient.createTask({
                taskId: `task-${Date.now()}`,
                prompt,
                modelId,
                mode: mode || 'AUTO',
                autonomy: effectiveAutonomy,
                workspace: workspaceCtx,
                editor: editorCtx
            });

            this.sessionStore.startNewTask(taskInfo.taskId, prompt, modelId, mode);
            this.replica.beginTask({
                taskId: taskInfo.taskId,
                prompt,
                modelId,
                autonomy: effectiveAutonomy,
                mode
            });

            const url = this.runtimeClient.getEventStreamUrl(taskInfo.taskId);
            const headers = await this.runtimeClient.getHeaders();
            
            await this.sseClient.connect(url, headers);
            
        } catch (e: any) {
            this.sendErrorToWebview(`Failed to start task: ${e.message}`);
        }
    }

    private async handleOpenFile(filePath: string, line?: number) {
        try {
            const workspaceCtx = await getWorkspaceContext();
            let fullPath = filePath;
            if (!path.isAbsolute(filePath) && workspaceCtx?.rootPath) {
                fullPath = path.join(workspaceCtx.rootPath, filePath);
            }
            if (fs.existsSync(fullPath)) {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
                const editor = await vscode.window.showTextDocument(doc, { preview: true });
                if (line !== undefined && line > 0) {
                    const pos = new vscode.Position(line - 1, 0);
                    editor.selection = new vscode.Selection(pos, pos);
                    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                }
            }
        } catch (e: any) {
            console.error('[COMU ChatViewProvider] Failed to open file:', e);
        }
    }

    private async handleSaveCode(content: string, suggestedPath?: string) {
        const workspaceCtx = await getWorkspaceContext();
        if (!workspaceCtx?.rootPath) {
            void vscode.window.showErrorMessage('Open a workspace folder before saving code.');
            return;
        }

        const filePath = await vscode.window.showInputBox({
            title: 'Save COMU code to workspace',
            prompt: 'Relative file path',
            value: suggestedPath || 'snippet.txt',
            validateInput: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return 'Enter a file path.';
                if (path.isAbsolute(trimmed)) return 'Use a path relative to the open workspace.';
                const root = path.resolve(workspaceCtx.rootPath);
                const target = path.resolve(root, trimmed);
                const relative = path.relative(root, target);
                return relative.startsWith('..') || path.isAbsolute(relative)
                    ? 'The file must stay inside the open workspace.'
                    : undefined;
            }
        });

        if (!filePath) return;

        const root = path.resolve(workspaceCtx.rootPath);
        const target = path.resolve(root, filePath.trim());
        const relative = path.relative(root, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            void vscode.window.showErrorMessage('COMU can only save code inside the open workspace.');
            return;
        }

        try {
            await fs.promises.mkdir(path.dirname(target), { recursive: true });
            await fs.promises.writeFile(target, content, 'utf8');
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
            await vscode.window.showTextDocument(doc, { preview: false });
            void vscode.window.showInformationMessage(`Saved COMU code to ${relative}.`);
        } catch (e: any) {
            void vscode.window.showErrorMessage(`Unable to save COMU code: ${e.message}`);
        }
    }


    private async handleCancelTask() {
        const state = this.sessionStore.getState();
        if (state.taskId && (state.status === 'running' || state.status === 'waiting_for_user')) {
            try {
                state.status = 'cancelling';
                // The panel already shows "cancelling" the moment the button is pressed, and the
                // runtime's own task.cancelled event confirms it.
                await this.runtimeClient.cancelTask(state.taskId);
            } catch (e: any) {
                void vscode.window.showErrorMessage(`Cancel failed: ${e.message}`);
            }
        }
    }

    private async handleRequestDiff(targetPath: string) {
        const state = this.sessionStore.getState();
        if (state.taskId) {
            await openDiff(this.runtimeClient, state.taskId, targetPath);
        }
    }

    public sendErrorToWebview(message: string) {
        if (this._view) {
            const msg: ExtensionMessage = { type: 'error', message };
            void this._view.webview.postMessage(msg);
        }
    }

}
