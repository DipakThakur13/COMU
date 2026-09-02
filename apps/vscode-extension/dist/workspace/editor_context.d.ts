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
export declare function getEditorContext(): EditorContextInfo;
//# sourceMappingURL=editor_context.d.ts.map