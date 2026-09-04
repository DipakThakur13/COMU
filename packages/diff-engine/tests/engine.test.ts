import { describe, it, expect } from "vitest";
import { ComuDiffEngine } from "../src/engine.js";

describe("Diff Engine", () => {
  it("should create a ChangeSet", () => {
    const engine = new ComuDiffEngine();
    const cs = engine.createChangeSet("task-123");
    
    expect(cs.taskId).toBe("task-123");
    expect(cs.status).toBe("ACTIVE");
    expect(cs.changes.size).toBe(0);
  });

  it("should track a CREATE operation", () => {
    const engine = new ComuDiffEngine();
    const cs = engine.createChangeSet("task-123");
    
    engine.recordChange(cs, "src/new.ts", "CREATE", "hello world");
    
    const change = cs.changes.get("src/new.ts");
    expect(change).toBeDefined();
    expect(change?.operation).toBe("CREATE");
    expect(change?.originalContent).toBeUndefined();
    expect(change?.newContent).toBe("hello world");
  });

  it("should preserve original baseline on multiple MODIFY operations", () => {
    const engine = new ComuDiffEngine();
    const cs = engine.createChangeSet("task-123");
    
    // First edit
    engine.recordChange(cs, "src/file.ts", "MODIFY", "edit 1", "original content");
    
    // Second edit
    engine.recordChange(cs, "src/file.ts", "MODIFY", "edit 2", "edit 1");
    
    const change = cs.changes.get("src/file.ts");
    expect(change?.operation).toBe("MODIFY");
    
    // Original content should STILL be "original content", not "edit 1"
    expect(change?.originalContent).toBe("original content");
    expect(change?.newContent).toBe("edit 2");
  });

  it("should generate unified diffs", () => {
    const engine = new ComuDiffEngine();
    const cs = engine.createChangeSet("task-123");
    
    engine.recordChange(cs, "src/file.ts", "MODIFY", "new content\nline 2", "old content\nline 2");
    
    const patch = engine.getUnifiedDiff(cs, "src/file.ts");
    expect(patch).toContain("--- src/file.ts\toriginal");
    expect(patch).toContain("+++ src/file.ts\tmodified");
    expect(patch).toContain("-old content");
    expect(patch).toContain("+new content");
  });
});
