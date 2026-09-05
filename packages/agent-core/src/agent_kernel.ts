import { AgentOrchestrator } from "./orchestrator.js";
import { IntentRouter, IntentClassification } from "./interaction/intent_router.js";
import { TaskContract, WorkspaceScope } from "./interaction/task_contract.js";
import { ClarificationHandler } from "./interaction/clarification_handler.js";
import { OrchestratorContext, AgentResult, AgentState } from "./interfaces.js";
import { AgentLimits } from "@comu/protocol";
import { ToolCapability } from "@comu/tool-core";

export interface AgentKernelInput {
  taskId: string;
  runId: string;
  systemPrompt: string;
  userPrompt: string;
  workspaceRoot: string;
  workspaceId?: string;
  limits: AgentLimits;
  abortSignal?: AbortSignal;
  onEvent: (event: any) => void;
  gitConfig?: any;
}

export class AgentKernel {
  private router: IntentRouter;
  private clarificationHandler: ClarificationHandler;

  constructor(private orchestrator: AgentOrchestrator) {
    this.router = new IntentRouter();
    this.clarificationHandler = new ClarificationHandler();
  }

  /**
   * The authoritative entry point for user-originated execution.
   */
  public async handle(input: AgentKernelInput): Promise<AgentResult> {
    input.onEvent({
      type: "agent.status",
      eventId: `evt-${Date.now()}`,
      taskId: input.taskId,
      timestamp: new Date().toISOString(),
      status: "CLASSIFYING"
    });

    const classification = this.router.route(input.userPrompt, {
      activeTaskId: input.taskId
    });

    if (classification.mode === "AMBIGUOUS") {
      input.onEvent({
        type: "agent.status",
        eventId: `evt-${Date.now()}`,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        status: "WAITING_FOR_USER"
      });
      return {
        status: "waiting_for_user",
        steps: 0,
        finalText: this.clarificationHandler.generateClarificationRequest(input.userPrompt)
      };
    }

    if (classification.mode === "CHAT") {
      input.onEvent({
        type: "agent.status",
        eventId: `evt-${Date.now()}`,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        status: "COMPLETED"
      });
      return {
        status: "completed",
        steps: 0,
        // Since we are not doing a secondary LLM call right now, provide a deterministic chat fallback
        finalText: "Hi! I'm COMU, your AI software engineer. What are we working on?"
      };
    }

    const taskContract = this.createContract(input, classification);
    
    // Delegate to orchestrator but pass the contract along
    return this.orchestrator.runWithContract(input, taskContract);
  }

  private createContract(input: AgentKernelInput, classification: IntentClassification): TaskContract {
    let allowedCapabilities: ToolCapability[] = [];
    let expectedMutation = false;
    let verificationRequired = false;

    if (classification.mode === "ASK" || classification.mode === "PLAN") {
      allowedCapabilities = ["read"];
    } else if (classification.mode === "AGENT") {
      allowedCapabilities = ["read", "write", "execute"];
      expectedMutation = true;
      verificationRequired = true;
    }

    return {
      taskId: input.taskId,
      runId: input.runId,
      mode: classification.mode,
      goal: input.userPrompt,
      expectedMutation,
      allowedCapabilities,
      workspaceScope: { rootPath: input.workspaceRoot, workspaceId: input.workspaceId },
      allowedTools: [],
      verificationRequired,
      limits: input.limits,
      createdAt: new Date().toISOString(),
      source: "user"
    };
  }
}
