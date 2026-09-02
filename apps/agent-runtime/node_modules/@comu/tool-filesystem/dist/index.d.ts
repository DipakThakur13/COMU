import { AgentTool } from '@comu/tool-core';

declare function resolveAndVerifyPath(requestPath: string, workspaceRoot: string): string;

interface ReadFileArgs {
    path: string;
}
declare const ReadFileTool: AgentTool<ReadFileArgs, {
    content: string;
    hash: string;
}>;

interface ListDirectoryArgs {
    path: string;
}
interface DirectoryEntry {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    isSymlink: boolean;
}
declare const ListDirectoryTool: AgentTool<ListDirectoryArgs, DirectoryEntry[]>;

interface GetWorkspaceTreeArgs {
    dir?: string;
    maxDepth?: number;
    maxEntries?: number;
}
interface WorkspaceTreeResult {
    tree: string;
    truncated: boolean;
}
declare const GetWorkspaceTreeTool: AgentTool<GetWorkspaceTreeArgs, WorkspaceTreeResult>;

interface CreateFileArgs {
    path: string;
    content: string;
}
declare const CreateFileTool: AgentTool<CreateFileArgs, {
    success: boolean;
    hash: string;
}>;
interface WriteFileArgs {
    path: string;
    content: string;
    expectedHash?: string;
}
declare const WriteFileTool: AgentTool<WriteFileArgs, {
    success: boolean;
    hash: string;
}>;

interface EditFileInput {
    path: string;
    edits: Array<{
        oldText: string;
        newText: string;
    }>;
    expectedHash?: string;
}
declare const EditFileTool: AgentTool<EditFileInput, {
    success: boolean;
    hash: string;
}>;

export { type CreateFileArgs, CreateFileTool, type DirectoryEntry, type EditFileInput, EditFileTool, type GetWorkspaceTreeArgs, GetWorkspaceTreeTool, type ListDirectoryArgs, ListDirectoryTool, type ReadFileArgs, ReadFileTool, type WorkspaceTreeResult, type WriteFileArgs, WriteFileTool, resolveAndVerifyPath };
