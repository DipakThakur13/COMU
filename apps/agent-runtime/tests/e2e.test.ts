import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AgentOrchestrator, OrchestratorContext } from "@comu/agent-core";
import { TerminalTool } from "@comu/terminal";
import { RunTestsTool } from "@comu/validation";
import { ToolExecutor, ToolRegistry } from "@comu/tool-core";
import { ComuDiffEngine } from "@comu/diff-engine";
import { ReadFileTool, CreateFileTool, WriteFileTool, EditFileTool } from "@comu/tool-filesystem";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

class MockAgentModel implements ModelProvider {
  id = "mock";
  name = "Mock Agent Model";

  public responses: ModelResponse[] = [];

  getCapabilities() { return { toolCalling: true, streaming: false, reasoning: false, vision: false, structuredOutput: true, maxContextTokens: 1000 }; }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    const res = this.responses.shift();
    if (!res) return { text: "No more responses mock" };
    return res;
  }
}

describe("E2E Agent Workflows", () => {
  const root = path.join(os.tmpdir(), "comu-e2e-" + Date.now());

  beforeAll(async () => {
    await fs.mkdir(root, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("E2E Test A: Create New File", async () => {
    const registry = new ToolRegistry();
    registry.register(CreateFileTool);
    const executor = new ToolExecutor(registry);
    
    const model = new MockAgentModel();
    // Simulate model calling create_file
    model.responses = [
      { text: "I will create the file.", toolCalls: [{ id: "call1", name: "create_file", arguments: { path: "hello.txt", content: "World" } }] },
      { text: "File created successfully." }
    ];

    const orchestrator = new AgentOrchestrator(model, registry, executor, new ComuDiffEngine());

    const events: any[] = [];
    await orchestrator.run({
      taskId: "e2e-1",
      workspaceRoot: root,
      systemPrompt: "",
      userPrompt: "Create a file named hello.txt",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 10000 },
      onEvent: (e) => events.push(e)
    });

    const content = await fs.readFile(path.join(root, "hello.txt"), "utf-8");
    expect(content).toBe("World");
    
    // Check change set emission
    expect(events.find(e => e.type === "change.created" && e.path === "hello.txt" && e.operation === "CREATE")).toBeDefined();
  });

  it("E2E Test B: Modify Existing File", async () => {
    await fs.writeFile(path.join(root, "modify.txt"), "Original Text");

    const registry = new ToolRegistry();
    registry.register(ReadFileTool);
    registry.register(EditFileTool);
    const executor = new ToolExecutor(registry);
    
    const model = new MockAgentModel();
    // In reality model would read first, but here we can mock it doing edit directly for test simplicity
    model.responses = [
      { 
        text: "Editing file.", 
        toolCalls: [{ 
          id: "call2", 
          name: "edit_file", 
          arguments: { 
            path: "modify.txt", 
            edits: [{ oldText: "Original", newText: "Updated" }] 
          } 
        }] 
      },
      { text: "File updated." }
    ];

    const orchestrator = new AgentOrchestrator(model, registry, executor, new ComuDiffEngine());

    const events: any[] = [];
    await orchestrator.run({
      taskId: "e2e-2",
      workspaceRoot: root,
      systemPrompt: "",
      userPrompt: "Update modify.txt",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 10000 },
      onEvent: (e) => events.push(e)
    });

    const content = await fs.readFile(path.join(root, "modify.txt"), "utf-8");
    expect(content).toBe("Updated Text");
    
    expect(events.find(e => e.type === "change.created" && e.path === "modify.txt" && e.operation === "MODIFY")).toBeDefined();
  });

  it("E2E Test C: Concurrency Conflict Handling", async () => {
    await fs.writeFile(path.join(root, "conflict.txt"), "Initial State");

    const registry = new ToolRegistry();
    registry.register(WriteFileTool);
    const executor = new ToolExecutor(registry);
    
    const model = new MockAgentModel();
    // Simulate model trying to write with a stale hash
    model.responses = [
      { 
        text: "Writing file.", 
        toolCalls: [{ 
          id: "call3", 
          name: "write_file", 
          arguments: { 
            path: "conflict.txt", 
            content: "Agent overwrite",
            expectedHash: "wrong-hash" // Intentional mismatch
          } 
        }] 
      },
      { text: "It failed due to conflict." }
    ];

    const orchestrator = new AgentOrchestrator(model, registry, executor, new ComuDiffEngine());

    const events: any[] = [];
    await orchestrator.run({
      taskId: "e2e-3",
      workspaceRoot: root,
      systemPrompt: "",
      userPrompt: "Update conflict.txt",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 10000 },
      onEvent: (e) => events.push(e)
    });

    // File should remain unchanged
    const content = await fs.readFile(path.join(root, "conflict.txt"), "utf-8");
    expect(content).toBe("Initial State");
    
    // The tool event should show the conflict error
    const toolEvent = events.find(e => e.type === "tool.completed" && e.tool === "write_file");
    expect(toolEvent).toBeDefined();
    expect(toolEvent.result?.error).toMatch(/CONFLICT/);
  });

  it("E2E Test D: Partial Mutation Failure", async () => {
    await fs.writeFile(path.join(root, "partial.txt"), "Initial State");

    // A malicious tool that writes then throws
    const MaliciousWriteTool = {
      name: "write_file",
      description: "fails halfway",
      capabilities: ["write"],
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: async (args: any, ctx: any) => {
        await fs.writeFile(path.join(ctx.workspace.rootPath, args.path), "Oops, changed it!");
        throw new Error("I crashed halfway");
      }
    };

    const registry = new ToolRegistry();
    registry.register(ReadFileTool);
    registry.register(MaliciousWriteTool as any);
    const executor = new ToolExecutor(registry);
    
    const model = new MockAgentModel();
    model.responses = [
      { 
        text: "Using broken tool.", 
        toolCalls: [{ id: "call4", name: "write_file", arguments: { path: "partial.txt" } }] 
      }
    ];

    const orchestrator = new AgentOrchestrator(model, registry, executor, new ComuDiffEngine());

    const events: any[] = [];
    const result = await orchestrator.run({
      taskId: "e2e-4",
      workspaceRoot: root,
      systemPrompt: "",
      userPrompt: "Break it",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 10000 },
      onEvent: (e) => {
        if (e.type === "tool.completed") console.log("TOOL ERROR MSG:", e.result?.error);
        events.push(e);
      }
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE");
    
    const failedEvent = events.find(e => e.type === "task.failed");
    expect(failedEvent.payload.code).toBe("WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE");
  });

  it("E2E Test E: SSE Late Connection (Store Replay)", async () => {
    // Dynamic import to avoid top-level issues if any
    const { InMemoryTaskEventStore } = await import("../src/event_store");
    const store = new InMemoryTaskEventStore({ maxEventsPerTask: 5 });
    
    // Simulate emitting 6 events (exceeding limit)
    for (let i = 0; i < 6; i++) {
       store.append({ type: "agent.status", eventId: "e" + i, taskId: "e2e-5", timestamp: "now", status: "step " + i });
    }

    const history = store.getEvents("e2e-5");
    // Should have bounded to 5 events (e1 to e5)
    expect(history.length).toBe(5);
    expect(history[0].eventId).toBe("e1");
    expect(history[4].eventId).toBe("e5");
  });
  it("E2E Test F: Terminal Execution (Safe)", async () => {
    const registry = new ToolRegistry();
    registry.register(new TerminalTool());
    const executor = new ToolExecutor(registry);
    
    const model = new MockAgentModel();
    model.responses = [
      { text: "I will run node -v", toolCalls: [{ id: "call1", name: "execute_command", arguments: { executable: "node", args: ["-v"] } }] },
      { text: "Command complete." }
    ];

    const orchestrator = new AgentOrchestrator(model, registry, executor, new ComuDiffEngine());

    const events: any[] = [];
    await orchestrator.run({
      taskId: "e2e-term-safe",
      workspaceRoot: root,
      systemPrompt: "",
      userPrompt: "Check node version",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 10000 },
      onEvent: (e) => events.push(e)
    });

    const completionEvent = events.find(e => e.type === "tool.completed" && e.tool === "execute_command");
    expect(completionEvent).toBeDefined();
    expect(completionEvent.result?.exitCode).toBe(0);
  });

  it("E2E Test G: Terminal Execution (Dangerous Denied)", async () => {
    const registry = new ToolRegistry();
    registry.register(new TerminalTool());
    const executor = new ToolExecutor(registry);
    
    const model = new MockAgentModel();
    model.responses = [
      { text: "I will delete files", toolCalls: [{ id: "call1", name: "execute_command", arguments: { executable: "rm", args: ["-rf", "/"] } }] }
    ];

    const orchestrator = new AgentOrchestrator(model, registry, executor, new ComuDiffEngine());

    const events: any[] = [];
    await orchestrator.run({
      taskId: "e2e-term-danger",
      workspaceRoot: root,
      systemPrompt: "",
      userPrompt: "Delete all files",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 10000 },
      onEvent: (e) => events.push(e)
    });

    const completionEvent = events.find(e => e.type === "tool.completed" && e.tool === "execute_command");
    expect(completionEvent).toBeDefined();
    expect(completionEvent.result?.error).toMatch(/COMMAND_DENIED/);
  });

  it("E2E Test H: Validation Workflow (Tests Pass)", async () => {
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "echo pass" } }));
    
    const registry = new ToolRegistry();
    registry.register(new RunTestsTool());
    const executor = new ToolExecutor(registry);
    
    const model = new MockAgentModel();
    model.responses = [
      { text: "I will run tests", toolCalls: [{ id: "call1", name: "run_tests", arguments: {} }] },
      { text: "Tests passed." }
    ];

    const orchestrator = new AgentOrchestrator(model, registry, executor, new ComuDiffEngine());

    const events: any[] = [];
    await orchestrator.run({
      taskId: "e2e-val",
      workspaceRoot: root,
      systemPrompt: "",
      userPrompt: "Run tests",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 10000 },
      onEvent: (e) => events.push(e)
    });

    const completionEvent = events.find(e => e.type === "tool.completed" && e.tool === "run_tests");
    console.log("Validation Result:", JSON.stringify(completionEvent.result, null, 2));
    expect(completionEvent).toBeDefined();
    expect(completionEvent.result?.status).toBe("PASS");
  });
});
