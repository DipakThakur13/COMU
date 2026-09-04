import * as vscode from 'vscode';
import { RuntimeClient } from '../runtime/runtime_client';
import * as path from 'path';

export class DiffViewer {
    constructor(private client: RuntimeClient) {}
}

// Global provider instance
class ComuDiffProvider implements vscode.TextDocumentContentProvider {
    private contents = new Map<string, string>();
    
    public setContent(uri: vscode.Uri, content: string) {
        this.contents.set(uri.toString(), content);
    }
    
    provideTextDocumentContent(uri: vscode.Uri): string | vscode.ProviderResult<string> {
        return this.contents.get(uri.toString()) || '';
    }
}

export const globalDiffProvider = new ComuDiffProvider();

export async function openDiff(client: RuntimeClient, taskId: string, targetPath: string) {
    try {
        const diffData = await client.getDiff(taskId, targetPath);
        
        const originalUri = vscode.Uri.parse(`comu-diff:${taskId}/original/${targetPath}`);
        const newUri = vscode.Uri.parse(`comu-diff:${taskId}/modified/${targetPath}`);

        globalDiffProvider.setContent(originalUri, diffData.originalContent || '');
        globalDiffProvider.setContent(newUri, diffData.newContent || '');

        const title = `COMU Diff: ${path.basename(targetPath)}`;
        await vscode.commands.executeCommand('vscode.diff', originalUri, newUri, title);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to open diff: ${err.message}`);
    }
}
