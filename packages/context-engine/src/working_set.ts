import {
  WorkingSet,
  WorkingSetBudgets,
  FileContext,
  SearchResult,
  ModifiedFile,
  Diagnostic
} from "./interfaces.js";
import { SelectionContext } from "@comu/protocol";

export class WorkingSetManager {
  private ws: WorkingSet;

  constructor(budgets?: Partial<WorkingSetBudgets>) {
    this.ws = {
      openFiles: [],
      recentlyInspectedFiles: [],
      searchResults: [],
      diagnostics: [],
      modifiedFiles: [],
      revision: 0,
      budgets: {
        maxOpenFiles: 10,
        maxInspectedFiles: 10,
        maxSearchResults: 50,
        maxDiagnostics: 20,
        maxModifiedFiles: 20,
        ...budgets
      }
    };
  }

  public get(): WorkingSet {
    return this.ws;
  }

  private incrementRevision() {
    this.ws.revision += 1;
  }

  public updateActiveFile(file?: FileContext) {
    this.ws.activeFile = file;
    this.incrementRevision();
  }

  public updateSelection(selection?: SelectionContext) {
    this.ws.selection = selection;
    this.incrementRevision();
  }

  public setOpenFiles(files: FileContext[]) {
    this.ws.openFiles = files.slice(0, this.ws.budgets.maxOpenFiles);
    this.incrementRevision();
  }

  public addInspectedFile(file: FileContext) {
    // Deduplicate
    this.ws.recentlyInspectedFiles = this.ws.recentlyInspectedFiles.filter(f => f.path !== file.path);
    // Prepend
    this.ws.recentlyInspectedFiles.unshift(file);
    // Truncate
    if (this.ws.recentlyInspectedFiles.length > this.ws.budgets.maxInspectedFiles) {
      this.ws.recentlyInspectedFiles.length = this.ws.budgets.maxInspectedFiles;
    }
    this.incrementRevision();
  }

  public addSearchResults(results: SearchResult[]) {
    // Deduplicate against existing by file and line
    for (const res of results) {
      const exists = this.ws.searchResults.find(r => r.file === res.file && r.line === res.line);
      if (!exists) {
        this.ws.searchResults.unshift(res);
      }
    }
    // Truncate
    if (this.ws.searchResults.length > this.ws.budgets.maxSearchResults) {
      this.ws.searchResults.length = this.ws.budgets.maxSearchResults;
    }
    this.incrementRevision();
  }

  public updateDiagnostics(diagnostics: Diagnostic[]) {
    // Deduplicate by stable fingerprint (message + file)
    this.ws.diagnostics = [];
    const seen = new Set<string>();
    for (const diag of diagnostics) {
      const key = `${diag.file}:${diag.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        this.ws.diagnostics.push(diag);
      }
    }
    // Truncate
    if (this.ws.diagnostics.length > this.ws.budgets.maxDiagnostics) {
      this.ws.diagnostics.length = this.ws.budgets.maxDiagnostics;
    }
    this.incrementRevision();
  }

  public addModifiedFile(mod: ModifiedFile) {
    // Deduplicate
    this.ws.modifiedFiles = this.ws.modifiedFiles.filter(m => m.path !== mod.path);
    this.ws.modifiedFiles.unshift(mod);
    
    // Truncate
    if (this.ws.modifiedFiles.length > this.ws.budgets.maxModifiedFiles) {
      this.ws.modifiedFiles.length = this.ws.budgets.maxModifiedFiles;
    }
    this.incrementRevision();
  }

  public invalidateFile(path: string) {
    let changed = false;
    
    if (this.ws.activeFile?.path === path) {
      this.ws.activeFile = undefined;
      changed = true;
    }

    const openLen = this.ws.openFiles.length;
    this.ws.openFiles = this.ws.openFiles.filter(f => f.path !== path);
    if (this.ws.openFiles.length !== openLen) changed = true;

    const inspLen = this.ws.recentlyInspectedFiles.length;
    this.ws.recentlyInspectedFiles = this.ws.recentlyInspectedFiles.filter(f => f.path !== path);
    if (this.ws.recentlyInspectedFiles.length !== inspLen) changed = true;

    if (changed) {
      this.incrementRevision();
    }
  }
}
