import { describe, it, expect } from "vitest";
import { WorkingSetManager } from "../src/working_set.js";
import { FileContext } from "../src/interfaces.js";

describe("Batch 4: WorkingSetManager Tests", () => {
  it("should initialize with default budgets", () => {
    const manager = new WorkingSetManager();
    const ws = manager.get();
    expect(ws.openFiles).toEqual([]);
    expect(ws.revision).toBe(0);
    expect(ws.budgets.maxOpenFiles).toBe(10);
  });

  it("should update active file and increment revision", () => {
    const manager = new WorkingSetManager();
    const file: FileContext = { path: "src/index.ts", content: "code", isTruncated: false };
    
    manager.updateActiveFile(file);
    const ws = manager.get();
    
    expect(ws.activeFile).toEqual(file);
    expect(ws.revision).toBe(1);
  });

  it("should deduplicate and truncate recently inspected files", () => {
    const manager = new WorkingSetManager({ maxInspectedFiles: 2 });
    
    manager.addInspectedFile({ path: "file1", content: "1", isTruncated: false });
    manager.addInspectedFile({ path: "file2", content: "2", isTruncated: false });
    
    const ws1 = manager.get();
    expect(ws1.recentlyInspectedFiles.length).toBe(2);
    expect(ws1.recentlyInspectedFiles[0].path).toBe("file2");

    // Add file1 again, should move to front and not exceed budget
    manager.addInspectedFile({ path: "file1", content: "1_new", isTruncated: false });
    
    const ws2 = manager.get();
    expect(ws2.recentlyInspectedFiles.length).toBe(2);
    expect(ws2.recentlyInspectedFiles[0].path).toBe("file1");
    expect(ws2.recentlyInspectedFiles[1].path).toBe("file2");

    // Add file3, should push file2 out
    manager.addInspectedFile({ path: "file3", content: "3", isTruncated: false });
    
    const ws3 = manager.get();
    expect(ws3.recentlyInspectedFiles.length).toBe(2);
    expect(ws3.recentlyInspectedFiles[0].path).toBe("file3");
    expect(ws3.recentlyInspectedFiles[1].path).toBe("file1");
  });

  it("should deduplicate diagnostics", () => {
    const manager = new WorkingSetManager();
    
    manager.updateDiagnostics([
      { file: "a.ts", line: 1, message: "Error 1", severity: "error" },
      { file: "a.ts", line: 1, message: "Error 1", severity: "error" },
      { file: "b.ts", line: 2, message: "Error 2", severity: "warning" }
    ]);

    const ws = manager.get();
    expect(ws.diagnostics.length).toBe(2);
    expect(ws.diagnostics[0].file).toBe("a.ts");
    expect(ws.diagnostics[1].file).toBe("b.ts");
  });

  it("should handle file invalidation", () => {
    const manager = new WorkingSetManager();
    const fileA = { path: "a.ts", content: "A", isTruncated: false };
    const fileB = { path: "b.ts", content: "B", isTruncated: false };
    
    manager.updateActiveFile(fileA);
    manager.setOpenFiles([fileA, fileB]);
    manager.addInspectedFile(fileA);

    expect(manager.get().activeFile?.path).toBe("a.ts");
    expect(manager.get().openFiles.length).toBe(2);
    expect(manager.get().recentlyInspectedFiles.length).toBe(1);

    manager.invalidateFile("a.ts");

    const ws = manager.get();
    expect(ws.activeFile).toBeUndefined();
    expect(ws.openFiles.length).toBe(1);
    expect(ws.openFiles[0].path).toBe("b.ts");
    expect(ws.recentlyInspectedFiles.length).toBe(0);
  });
});
