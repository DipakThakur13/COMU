import * as vscode from 'vscode';
import { RuntimeClient } from '../runtime/runtime_client';
export declare class DiffViewer {
    private client;
    constructor(client: RuntimeClient);
}
declare class ComuDiffProvider implements vscode.TextDocumentContentProvider {
    private contents;
    setContent(uri: vscode.Uri, content: string): void;
    provideTextDocumentContent(uri: vscode.Uri): string | vscode.ProviderResult<string>;
}
export declare const globalDiffProvider: ComuDiffProvider;
export declare function openDiff(client: RuntimeClient, taskId: string, targetPath: string): Promise<void>;
export {};
//# sourceMappingURL=diff_viewer.d.ts.map