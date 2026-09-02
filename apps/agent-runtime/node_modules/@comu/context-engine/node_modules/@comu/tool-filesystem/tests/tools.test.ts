import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ReadFileTool } from "../src/read_file.js";
import { ListDirectoryTool } from "../src/list_directory.js";
import { GetWorkspaceTreeTool } from "../src/get_workspace_tree.js";
import { CreateFileTool, WriteFileTool } from "../src/write_file.js";
import { EditFileTool } from "../src/edit_file.js";
import { ToolContext } from "@comu/tool-core";
import { ToolError } from "@comu/shared";
import * as fs from "fs/promises";
import * as path from "path";

describe("Filesystem Tools", () => {
  const root = path.resolve(__dirname, "fixtures");
  let dummyContext: ToolContext;

  beforeEach(async () => {
    dummyContext = {
      taskId: "test",
      workspace: { rootPath: root },
      limits: { maxResults: 100, maxBytes: 1024 * 1024 }
    };
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "test.txt"), "hello world");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("ReadFileTool should read a file", async () => {
    const result = await ReadFileTool.execute({ path: "src/test.txt" }, dummyContext);
    expect(result.content).toBe("hello world");
    expect(result.hash).toBeDefined();
  });

  it("ReadFileTool should reject large files", async () => {
    dummyContext.limits.maxBytes = 5; // Very small limit
    await expect(ReadFileTool.execute({ path: "src/test.txt" }, dummyContext)).rejects.toThrow(ToolError);
  });

  it("ListDirectoryTool should list entries", async () => {
    const entries = await ListDirectoryTool.execute({ path: "src" }, dummyContext);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("test.txt");
    expect(entries[0].isFile).toBe(true);
  });

  it("GetWorkspaceTreeTool should generate a tree", async () => {
    const result = await GetWorkspaceTreeTool.execute({}, dummyContext);
    expect(result.tree).toContain("fixtures/");
    expect(result.tree).toContain("src/");
    expect(result.tree).toContain("test.txt");
    expect(result.truncated).toBe(false);
  });

  it("GetWorkspaceTreeTool should truncate when limits exceeded", async () => {
    dummyContext.limits.maxResults = 1;
    const result = await GetWorkspaceTreeTool.execute({}, dummyContext);
    expect(result.truncated).toBe(true);
  });

  it("CreateFileTool should create a file", async () => {
    const result = await CreateFileTool.execute({ path: "src/new.txt", content: "hello" }, dummyContext);
    expect(result.success).toBe(true);
    expect(result.hash).toBeDefined();
    
    const content = await fs.readFile(path.join(root, "src/new.txt"), "utf-8");
    expect(content).toBe("hello");
  });

  it("CreateFileTool should fail if file exists", async () => {
    await expect(CreateFileTool.execute({ path: "src/test.txt", content: "hello" }, dummyContext)).rejects.toThrow(ToolError);
  });

  it("WriteFileTool should overwrite a file", async () => {
    await WriteFileTool.execute({ path: "src/test.txt", content: "overwritten" }, dummyContext);
    const content = await fs.readFile(path.join(root, "src/test.txt"), "utf-8");
    expect(content).toBe("overwritten");
  });

  it("WriteFileTool should detect concurrency conflict", async () => {
    await expect(WriteFileTool.execute({ path: "src/test.txt", content: "overwritten", expectedHash: "badhash" }, dummyContext)).rejects.toThrow(/CONFLICT/);
  });

  it("EditFileTool should perform exact match replacement", async () => {
    const origHash = (await ReadFileTool.execute({ path: "src/test.txt" }, dummyContext)).hash;
    const result = await EditFileTool.execute({ 
      path: "src/test.txt", 
      expectedHash: origHash,
      edits: [{ oldText: "world", newText: "comu" }] 
    }, dummyContext);
    expect(result.success).toBe(true);

    const content = await fs.readFile(path.join(root, "src/test.txt"), "utf-8");
    expect(content).toBe("hello comu");
  });

  it("EditFileTool should reject 0 matches", async () => {
    await expect(EditFileTool.execute({ 
      path: "src/test.txt", 
      edits: [{ oldText: "missing", newText: "comu" }] 
    }, dummyContext)).rejects.toThrow(/0 occurrences|not found/i);
  });

  it("EditFileTool should reject multiple matches", async () => {
    await fs.writeFile(path.join(root, "src/multi.txt"), "foo foo");
    await expect(EditFileTool.execute({ 
      path: "src/multi.txt", 
      edits: [{ oldText: "foo", newText: "bar" }] 
    }, dummyContext)).rejects.toThrow(/multiple times/);
  });
});
