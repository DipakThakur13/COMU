import { SelectionContext, TaskRequest } from '@comu/protocol';
import { ToolExecutor } from '@comu/tool-core';

interface FileContext {
    path: string;
    content: string;
    isTruncated: boolean;
}
interface WorkspaceContext {
    rootPath: string;
    workspaceId?: string;
}
interface RepositoryMap {
    tree: string;
    isTruncated: boolean;
}
interface CompiledContext {
    workspace: WorkspaceContext;
    activeFile?: FileContext;
    selection?: SelectionContext;
    openFiles: FileContext[];
    repositoryMap?: RepositoryMap;
    metadata?: Record<string, unknown>;
}
interface ContextBudget {
    maxTotalChars: number;
    maxFileChars: number;
    maxTreeDepth: number;
}

declare class ContextEngine {
    private executor;
    constructor(executor: ToolExecutor);
    compile(request: TaskRequest, budget: ContextBudget): Promise<CompiledContext>;
    private safeReadFile;
}

export { type CompiledContext, type ContextBudget, ContextEngine, type FileContext, type RepositoryMap, type WorkspaceContext };
