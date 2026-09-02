import { describe, it, expect, vi } from "vitest";
import { AgentOrchestrator, OrchestratorContext } from "../src/orchestrator.js";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";
import { ToolExecutor, ToolRegistry } from "@comu/tool-core";
import { ComuDiffEngine } from "@comu/diff-engine";

class MockModel implements ModelProvider {
  id = "mock";
  name = "Mock";
  
  public responses: ModelResponse[] = [];
  
  getCapabilities() { return { toolCalling: true, streaming: false, reasoning: false, vision: false, structuredOutput: true, maxContextTokens: 100 }; }
  
  async generate(req: ModelRequest): Promise<ModelResponse> {
    const res = this.responses.shift();
    if (!res) throw new Error("No more mock responses");
    return res;
  }
}

describe("Agent Orchestrator", () => {
  it("should run successfully without tools", async () => {
    const model = new MockModel();
    model.responses = [{ text: "Hello world" }];
    
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry);
    const diffEngine = new ComuDiffEngine();
    
    const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine);
    
    const events: any[] = [];
    const ctx: OrchestratorContext = {
      taskId: "t1",
      workspaceRoot: "/fake",
      systemPrompt: "sys",
      userPrompt: "hi",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 1000 },
      onEvent: (e) => events.push(e)
    };
    
    const res = await orchestrator.run(ctx);
    
    expect(res.status).toBe("completed");
    expect(res.finalText).toBe("Hello world");
    expect(res.steps).toBe(1);
    
    expect(events.find(e => e.type === "task.started")).toBeDefined();
    expect(events.find(e => e.type === "task.completed")).toBeDefined();
  });

  it("should handle tool calls and limits", async () => {
    const model = new MockModel();
    model.responses = [
      { text: "", toolCalls: [{ id: "c1", name: "test_tool", arguments: {} }] },
      { text: "Done after tool" }
    ];
    
    const registry = new ToolRegistry();
    registry.register({
      name: "test_tool",
      description: "test",
      capabilities: ["read"],
      inputSchema: {},
      execute: async () => "tool result"
    });
    
    const executor = new ToolExecutor(registry);
    const diffEngine = new ComuDiffEngine();
    const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine);
    
    const events: any[] = [];
    const ctx: OrchestratorContext = {
      taskId: "t2",
      workspaceRoot: "/fake",
      systemPrompt: "sys",
      userPrompt: "hi",
      limits: { maxSteps: 5, maxToolCalls: 5, maxExecutionTimeMs: 1000 },
      onEvent: (e) => events.push(e)
    };
    
    const res = await orchestrator.run(ctx);
    
    expect(res.status).toBe("completed");
    expect(res.finalText).toBe("Done after tool");
    expect(events.find(e => e.type === "tool.completed" && e.result === "tool result")).toBeDefined();
  });

  it("should stop if max steps reached", async () => {
    const model = new MockModel();
    model.responses = [
      { text: "", toolCalls: [{ id: "c1", name: "test_tool", arguments: {} }] },
      { text: "", toolCalls: [{ id: "c2", name: "test_tool", arguments: {} }] }
    ];
    
    const registry = new ToolRegistry();
    registry.register({ name: "test_tool", description: "test", capabilities: ["read"], inputSchema: {}, execute: async () => "res" });
    const executor = new ToolExecutor(registry);
    const orchestrator = new AgentOrchestrator(model, registry, executor, new ComuDiffEngine());
    
    const ctx: OrchestratorContext = {
      taskId: "t3",
      workspaceRoot: "/fake",
      systemPrompt: "sys",
      userPrompt: "hi",
      limits: { maxSteps: 1, maxToolCalls: 5, maxExecutionTimeMs: 1000 }, // limits maxSteps to 1
      onEvent: () => {}
    };
    
    const res = await orchestrator.run(ctx);
    expect(res.status).toBe("limit_reached");
  });
});
