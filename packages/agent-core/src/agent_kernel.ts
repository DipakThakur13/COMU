import { AgentOrchestrator } from "./orchestrator.js";
import { IntentRouter, IntentClassification } from "./interaction/intent_router.js";
import { TaskContract, WorkspaceScope } from "./interaction/task_contract.js";
import { ClarificationHandler } from "./interaction/clarification_handler.js";
import { OrchestratorContext, AgentResult, AgentState } from "./interfaces.js";
import { AgentLimits, TaskMode, TASK_MODES } from "@comu/protocol";
import { ToolCapability } from "@comu/tool-core";

export interface AgentKernelInput {
  taskId: string;
  runId: string;
  /** Explicit mode from the composer. Omitted or AUTO means classify. */
  mode?: TaskMode;
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
    if (input.abortSignal?.aborted) {
      input.onEvent({
        type: "agent.status",
        eventId: `evt-${Date.now()}`,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        status: "CANCELLED"
      });
      input.onEvent({
        type: "task.cancelled",
        eventId: `evt-${Date.now()}`,
        taskId: input.taskId,
        timestamp: new Date().toISOString()
      });
      return {
        status: "cancelled",
        steps: 0
      };
    }

    input.onEvent({
      type: "agent.status",
      eventId: `evt-${Date.now()}`,
      taskId: input.taskId,
      timestamp: new Date().toISOString(),
      status: "CLASSIFYING"
    });

    if (input.abortSignal?.aborted) {
      input.onEvent({
        type: "agent.status",
        eventId: `evt-${Date.now()}`,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        status: "CANCELLED"
      });
      input.onEvent({
        type: "task.cancelled",
        eventId: `evt-${Date.now()}`,
        taskId: input.taskId,
        timestamp: new Date().toISOString()
      });
      return {
        status: "cancelled",
        steps: 0
      };
    }

    const classification = this.resolveClassification(input);

    input.onEvent({
      type: "task.mode_resolved",
      eventId: `evt-${Date.now()}-mode`,
      taskId: input.taskId,
      timestamp: new Date().toISOString(),
      mode: classification.mode,
      source: classification.source,
      confidence: classification.confidence,
      reasons: classification.reasons
    });

    if (classification.mode === "AMBIGUOUS") {
      if (input.abortSignal?.aborted) {
        input.onEvent({
          type: "agent.status",
          eventId: `evt-${Date.now()}`,
          taskId: input.taskId,
          timestamp: new Date().toISOString(),
          status: "CANCELLED"
        });
        input.onEvent({
          type: "task.cancelled",
          eventId: `evt-${Date.now()}`,
          taskId: input.taskId,
          timestamp: new Date().toISOString()
        });
        return {
          status: "cancelled",
          steps: 0
        };
      }
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
      const finalText = "Hi! I'm COMU, your AI software engineer. What are we working on?";
      input.onEvent({
        type: "agent.status",
        eventId: `evt-${Date.now()}`,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        status: "COMPLETED"
      });
      // CHAT bypasses the engineering orchestrator, so it must publish its own
      // terminal event. The VS Code session and webview receive final responses
      // exclusively through task.completed.finalText.
      input.onEvent({
        type: "task.completed",
        eventId: `evt-${Date.now()}-completed`,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        finalText
      });
      return {
        status: "completed",
        steps: 0,
        // Since we are not doing a secondary LLM call right now, provide a deterministic chat fallback.
        finalText
      };
    }

    const taskContract = this.createContract(input, classification);
    
    // Delegate to orchestrator but pass the contract along
    return this.orchestrator.runWithContract(input, taskContract);
  }

  /**
   * An explicit mode from the user is authoritative: no regex, no model, no clarification.
   * Only AUTO (or an absent mode) goes through the IntentRouter.
   */
  private resolveClassification(input: AgentKernelInput): IntentClassification {
    const requested = input.mode;
    if (requested && requested !== "AUTO") {
      if (!TASK_MODES.includes(requested)) {
        throw new Error(`INVALID_MODE: '${requested}' is not one of ${TASK_MODES.join(", ")}`);
      }
      return {
        mode: requested,
        confidence: 1.0,
        source: "explicit",
        reasons: ["mode selected by user"],
        requiresClarification: false
      };
    }
    return this.router.route(input.userPrompt, { activeTaskId: input.taskId });
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
