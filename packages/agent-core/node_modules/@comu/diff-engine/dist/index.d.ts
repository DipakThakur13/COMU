interface ChangedFile {
    path: string;
    operation: "CREATE" | "MODIFY";
    originalHash?: string;
    newHash?: string;
    originalContent?: string;
    newContent: string;
}
interface ChangeSet {
    changeSetId: string;
    taskId: string;
    workspaceId?: string;
    status: "ACTIVE" | "COMPLETED" | "FAILED" | "ROLLED_BACK";
    changes: Map<string, ChangedFile>;
    createdAt: string;
    updatedAt: string;
}
interface DiffEngine {
    createChangeSet(taskId: string, workspaceId?: string): ChangeSet;
    recordChange(changeSet: ChangeSet, path: string, operation: "CREATE" | "MODIFY", newContent: string, originalContent?: string, originalHash?: string, newHash?: string): void;
    getUnifiedDiff(changeSet: ChangeSet, path: string): string | undefined;
    getDiffs(changeSet: ChangeSet): Map<string, string>;
}

declare class ComuDiffEngine implements DiffEngine {
    createChangeSet(taskId: string, workspaceId?: string): ChangeSet;
    recordChange(changeSet: ChangeSet, path: string, operation: "CREATE" | "MODIFY", newContent: string, originalContent?: string, originalHash?: string, newHash?: string): void;
    getUnifiedDiff(changeSet: ChangeSet, path: string): string | undefined;
    getDiffs(changeSet: ChangeSet): Map<string, string>;
}

export { type ChangeSet, type ChangedFile, ComuDiffEngine, type DiffEngine };
