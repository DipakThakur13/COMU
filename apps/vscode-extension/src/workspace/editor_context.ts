import * as vscode from 'vscode';

export interface EditorContextInfo {
    activeFile?: string;
    openFiles: string[];
    selection?: {
        filePath: string;
        startLine: number;
        startCharacter: number;
        endLine: number;
        endCharacter: number;
        text: string;
    };
}

export function getEditorContext(): EditorContextInfo {
    const openFiles = vscode.workspace.textDocuments
        .filter(doc => !doc.isUntitled && doc.uri.scheme === 'file')
        .map(doc => doc.uri.fsPath);

    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || activeEditor.document.uri.scheme !== 'file') {
        return { openFiles };
    }

    const activeFile = activeEditor.document.uri.fsPath;
    let selectionContext: EditorContextInfo['selection'] = undefined;

    if (!activeEditor.selection.isEmpty) {
        selectionContext = {
            filePath: activeFile,
            startLine: activeEditor.selection.start.line + 1,
            startCharacter: activeEditor.selection.start.character,
            endLine: activeEditor.selection.end.line + 1,
            endCharacter: activeEditor.selection.end.character,
            text: activeEditor.document.getText(activeEditor.selection)
        };
    }

    return {
        activeFile,
        openFiles,
        selection: selectionContext
    };
}
