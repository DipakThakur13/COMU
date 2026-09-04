import * as vscode from 'vscode';
import { SecretManager } from './security/secrets';
import { RuntimeClient } from './runtime/runtime_client';
import { HealthMonitor } from './runtime/health_monitor';
import { SSEClient } from './runtime/sse_client';
import { TaskSessionStore } from './sessions/task_session_store';
import { ChatViewProvider } from './providers/chat_provider';
import { ProviderManager } from './providers/provider_manager';
import { globalDiffProvider } from './diff/diff_viewer';

import { ServerProcessManager } from './runtime/server_process_manager';

let serverManager: ServerProcessManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('COMU AI Coding Agent is now active!');

  SecretManager.initialize(context);

  const runtimeClient = new RuntimeClient();
  const sessionStore = new TaskSessionStore();
  const providerManager = new ProviderManager();
  
  // Auto-start local Agent Runtime backend if not already running
  serverManager = new ServerProcessManager(context.extensionUri, runtimeClient);
  serverManager.ensureServerRunning().catch(err => {
      console.warn('[COMU] Error during auto-start backend:', err);
  });

  context.subscriptions.push({
      dispose: () => {
          serverManager?.stopServer();
      }
  });

  let chatProvider: ChatViewProvider;

  const sseClient = new SSEClient(
      (event) => {
          const added = sessionStore.addEvent(event);
          if (added && chatProvider) {
              chatProvider.sendStateToWebview();
          }
      },
      (error) => {
          console.error("SSE Error:", error);
          if (chatProvider) {
              chatProvider.sendErrorToWebview(`Connection dropped: ${error.message}`);
          }
      }
  );

  chatProvider = new ChatViewProvider(context.extensionUri, runtimeClient, sessionStore, sseClient, providerManager);

  const healthMonitor = new HealthMonitor(runtimeClient, async (connected) => {
      sessionStore.setOffline(!connected);
      if (connected) {
          const config = await providerManager.getRawConfig();
          await runtimeClient.pushConfig(config);
      }
      chatProvider.sendStateToWebview();
  });

  healthMonitor.start();

  context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider, {
          webviewOptions: {
              retainContextWhenHidden: true
          }
      })
  );

  context.subscriptions.push(
      vscode.commands.registerCommand('comu.openChat', () => {
          vscode.commands.executeCommand('workbench.view.extension.comu-sidebar');
      })
  );

  context.subscriptions.push(
      vscode.commands.registerCommand('comu.openProviderSettings', async () => {
          await vscode.commands.executeCommand('workbench.view.extension.comu-sidebar');
          chatProvider.openSettings();
      })
  );

  context.subscriptions.push(
      vscode.commands.registerCommand('comu.configureNvidia', async () => {
          await vscode.commands.executeCommand('workbench.view.extension.comu-sidebar');
          chatProvider.openSettings('nvidia');
      })
  );

  context.subscriptions.push(
      vscode.commands.registerCommand('comu.testProviderConnection', async () => {
          const result = await providerManager.testConnection('nvidia');
          if (result.status === 'CONNECTED') {
              vscode.window.showInformationMessage(`NVIDIA Connection Successful! (${result.latencyMs ?? 0}ms)`);
          } else {
              vscode.window.showErrorMessage(`NVIDIA Connection Failed: ${result.message || 'Unknown error'}`);
          }
      })
  );



  context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider('comu-diff', globalDiffProvider)
  );
}

export function deactivate() {
  if (serverManager) {
    serverManager.stopServer();
    serverManager = undefined;
  }
}
