import { describe, it, expect } from "vitest";
import { buildTaskSystemPrompt } from "../src/system_prompt.js";
import { AgentOrchestrator } from "../src/orchestrator.js";
import { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";
import { ToolExecutor, ToolRegistry } from "@comu/tool-core";
import { ComuDiffEngine } from "@comu/diff-engine";

/**
 * The instructions an agent task runs under.
 *
 * It used to be one sentence. The model was not told where it was, what its tools were for, that a
 * write could be refused, what finishing meant, or that files it left behind count against it.
 */

const ALL_TOOLS = [
  "read_file", "list_directory", "get_workspace_tree", "search_text",
  "create_file", "write_file", "edit_file", "execute_command",
  "run_tests", "run_typecheck", "run_build", "run_linter",
  "git_status", "git_diff", "git_commit", "web_docs", "delegate_subtask"
];
const READ_TOOLS = ["read_file", "list_directory", "get_workspace_tree", "search_text", "web_docs", "delegate_subtask"];

const agent = (over: Partial<Parameters<typeof buildTaskSystemPrompt>[0]> = {}) =>
  buildTaskSystemPrompt({ workspaceRoot: "/work/repo", autonomy: "ask", tools: ALL_TOOLS, expectedMutation: true, ...over });

describe("the task system prompt", () => {
  it("names the workspace root and how paths resolve against it", () => {
    const prompt = agent();
    expect(prompt).toContain("/work/repo");
    expect(prompt).toMatch(/relative to that root/);
    expect(prompt).toMatch(/outside the root is refused/);
  });

  it("says when to reach for each kind of tool it offers", () => {
    const prompt = agent();
    for (const name of ["search_text", "read_file", "edit_file", "write_file", "run_tests", "execute_command"]) {
      expect(prompt).toContain(name);
    }
    expect(prompt).toMatch(/read a file before you change it/i);
  });

  it("describes only the tools the task is actually offered", () => {
    const prompt = buildTaskSystemPrompt({ workspaceRoot: "/r", autonomy: "readonly", tools: READ_TOOLS, expectedMutation: false });
    expect(prompt).not.toContain("edit_file");
    expect(prompt).not.toContain("execute_command");
    expect(prompt).toMatch(/read-only/i);
    // A read-only task is never told how writes are approved, or to clean up files it cannot create.
    expect(prompt).not.toMatch(/APPROVAL_DENIED/);
    expect(prompt).not.toMatch(/scratch files/);
  });

  it("explains the approval gate and what a denial means when writes are supervised", () => {
    const prompt = agent({ autonomy: "ask" });
    expect(prompt).toMatch(/waits for their approval/);
    expect(prompt).toContain("APPROVAL_DENIED");
    expect(prompt).toMatch(/do not repeat it/i);
    // Unsupervised runs have no gate to describe.
    expect(agent({ autonomy: "auto" })).not.toContain("APPROVAL_DENIED");
  });

  it("says what finishing means, and not to claim what it has not seen", () => {
    const prompt = agent();
    expect(prompt).toMatch(/final message is your report/);
    expect(prompt).toMatch(/If you did not run the tests, do not say they pass/);
    expect(prompt).toMatch(/COMU runs its own verification/);
  });

  it("tells the agent not to leave scratch or working files behind (t2-ts-endpoint failed on one)", () => {
    const prompt = agent();
    expect(prompt).toMatch(/Do not create scratch files, debugging scripts, notes, backups/);
    expect(prompt).toMatch(/no tool to delete them/);
  });
});

describe("the orchestrator sends it", () => {
  class CapturingModel implements ModelProvider {
    id = "capture";
    name = "Capture";
    public systemPrompts: string[] = [];
    getCapabilities() {
      return { toolCalling: true, streaming: false, reasoning: false, vision: false, structuredOutput: true, maxContextTokens: 100_000 };
    }
    async generate(req: ModelRequest): Promise<ModelResponse> {
      this.systemPrompts.push(req.systemPrompt ?? "");
      return { text: "The request enters at src/main.ts." };
    }
  }

  it("with the task's workspace, followed by anything the host adds", async () => {
    const model = new CapturingModel();
    const registry = new ToolRegistry();
    registry.register({ name: "read_file", description: "read", capabilities: ["read"], inputSchema: {}, execute: async () => ({ content: "", hash: "h" }) });
    const orchestrator = new AgentOrchestrator(model, registry, new ToolExecutor(registry), new ComuDiffEngine());
    await orchestrator.run({
      taskId: "sp",
      workspaceRoot: "/work/onboarding",
      mode: "ASK",
      autonomy: "readonly",
      systemPrompt: "HOST ADDITION",
      userPrompt: "Explain how a request flows through this repository.",
      limits: { maxSteps: 3, maxToolCalls: 3, maxExecutionTimeMs: 5000 },
      onEvent: () => {}
    });

    expect(model.systemPrompts.length).toBeGreaterThan(0);
    const sent = model.systemPrompts[0];
    expect(sent).toContain("/work/onboarding");
    expect(sent).toMatch(/read-only/i);
    expect(sent.trimEnd().endsWith("HOST ADDITION")).toBe(true);
  });
});
