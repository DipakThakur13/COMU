import * as vscode from 'vscode';
import { RuntimeClient } from '../runtime/runtime_client';
import { SSEClient } from '../runtime/sse_client';
import { TaskSessionStore } from '../sessions/task_session_store';
import { ProviderManager } from './provider_manager';
export declare class ChatViewProvider implements vscode.WebviewViewProvider {
    private readonly _extensionUri;
    private readonly runtimeClient;
    private readonly sessionStore;
    private readonly sseClient;
    private readonly providerManager;
    static readonly viewType = "comu.chatView";
    private _view?;
    constructor(_extensionUri: vscode.Uri, runtimeClient: RuntimeClient, sessionStore: TaskSessionStore, sseClient: SSEClient, providerManager: ProviderManager);
    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void;
    sendProvidersToWebview(): Promise<void>;
    private pushConfigToRuntime;
    private handleSubmitPrompt;
    private handleCancelTask;
    private handleRequestDiff;
    sendStateToWebview(): void;
    sendErrorToWebview(message: string): void;
    private _getHtmlForWebview;
}
//# sourceMappingURL=chat_provider.d.ts.map