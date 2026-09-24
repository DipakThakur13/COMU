import * as vscode from 'vscode';
import { createHash } from 'crypto';

export interface WorkspaceContextInfo {
    rootPath: string;
    workspaceId: string;
}

/**
 * The workspace folder, when it can be known without asking: the only folder, or the folder of the
 * active editor. Undefined otherwise, so nothing that runs without a user action ever raises a
 * folder picker.
 */
export function unambiguousWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    if (folders.length === 1) return folders[0].uri.fsPath;
    const active = vscode.window.activeTextEditor;
    return active ? vscode.workspace.getWorkspaceFolder(active.document.uri)?.uri.fsPath : undefined;
}

export async function getWorkspaceContext(): Promise<WorkspaceContextInfo | null> {
    const folders = vscode.workspace.workspaceFolders;
    
    if (!folders || folders.length === 0) {
        return null;
    }

    let targetFolder: vscode.WorkspaceFolder | undefined;

    if (folders.length === 1) {
        targetFolder = folders[0];
    } else {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            targetFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
        }

        if (!targetFolder) {
            targetFolder = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Select workspace folder for COMU' });
        }
    }

    if (!targetFolder) {
        return null;
    }

    const rootPath = targetFolder.uri.fsPath;
    
    // Deterministic ID based on the selected target folder
    const workspaceId = createHash('sha256').update(targetFolder.uri.toString()).digest('hex').substring(0, 16);

    return {
        rootPath,
        workspaceId
    };
}
