import { SelectionContext } from "@comu/protocol";

export interface Diagnostic {
  file: string;
  line: number;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface SearchResult {
  file: string;
  line: number;
  content: string;
}

export interface ModifiedFile {
  path: string;
  source: "USER_CHANGE" | "COMU_CHANGE" | "EXTERNAL_CHANGE" | "UNKNOWN";
  timestamp: string;
}

export interface WorkingSetBudgets {
  maxOpenFiles: number;
  maxInspectedFiles: number;
  maxSearchResults: number;
  maxDiagnostics: number;
  maxModifiedFiles: number;
}

export interface WorkingSet {
  activeFile?: FileContext;
  selection?: SelectionContext;
  openFiles: FileContext[];
  recentlyInspectedFiles: FileContext[];
  searchResults: SearchResult[];
  diagnostics: Diagnostic[];
  modifiedFiles: ModifiedFile[];
  budgets: WorkingSetBudgets;
  revision: number;
}
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
