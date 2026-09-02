import { SelectionContext } from "@comu/protocol";

export interface FileContext {
  path: string;
  content: string;
  isTruncated: boolean;
}

export interface WorkspaceContext {
  rootPath: string;
  workspaceId?: string;
}

export interface RepositoryMap {
  tree: string;
  isTruncated: boolean;
}

export interface CompiledContext {
  workspace: WorkspaceContext;
  activeFile?: FileContext;
  selection?: SelectionContext;
  openFiles: FileContext[];
  repositoryMap?: RepositoryMap;
  metadata?: Record<string, unknown>;
}

export interface ContextBudget {
  maxTotalChars: number;
  maxFileChars: number;
  maxTreeDepth: number;
}
