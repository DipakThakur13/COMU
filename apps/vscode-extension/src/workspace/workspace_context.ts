import * as vscode from 'vscode';
import { createHash } from 'crypto';

export interface WorkspaceContextInfo {
    rootPath: string;
    workspaceId: string;
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
