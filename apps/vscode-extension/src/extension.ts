import * as vscode from 'vscode';
import { SecretManager } from './security/secrets';
import { RuntimeClient } from './runtime/runtime_client';
import { HealthMonitor } from './runtime/health_monitor';
import { SSEClient } from './runtime/sse_client';
import { TaskSessionStore } from './sessions/task_session_store';
import { ChatViewProvider } from './providers/chat_provider';
import { ProviderManager } from './providers/provider_manager';
import { globalDiffProvider } from './diff/diff_viewer';

export function activate(context: vscode.ExtensionContext) {
  console.log('COMU AI Coding Agent is now active!');

  SecretManager.initialize(context);

  const runtimeClient = new RuntimeClient();
  const sessionStore = new TaskSessionStore();
  const providerManager = new ProviderManager();
  
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
      vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider)
  );

  context.subscriptions.push(
      vscode.commands.registerCommand('comu.openChat', () => {
          vscode.commands.executeCommand('workbench.view.extension.comu-sidebar');
      })
  );



  context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider('comu-diff', globalDiffProvider)
  );
}

export function deactivate() {}
