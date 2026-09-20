import { AgentOrchestrator } from "./orchestrator.js";
import { IntentRouter, IntentClassification } from "./interaction/intent_router.js";
import { TaskContract, WorkspaceScope } from "./interaction/task_contract.js";
import { ClarificationHandler } from "./interaction/clarification_handler.js";
import { OrchestratorContext, AgentResult, AgentState } from "./interfaces.js";
import { AgentLimits, TaskMode, TASK_MODES } from "@comu/protocol";
import { ToolCapability } from "@comu/tool-core";
import { ModelRequestManager } from "@comu/model-core";
import { ProviderCancelledError } from "@comu/shared";
import { basename } from "path";

export const CHAT_SYSTEM_PROMPT =
  "You are COMU, an AI software engineer working inside VS Code. " +
  "This is a conversational turn: answer directly, concisely and helpfully. " +
  "You have no tools in this turn and cannot read or change files or run commands; " +
  "if the user wants work done in the repository, say what you would do and suggest switching to Agent, Plan or Ask mode. " +
  "Do not invent details about the workspace you cannot see.";

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
      return this.handleChat(input);
    }

    const taskContract = this.createContract(input, classification);
    
    // Delegate to orchestrator but pass the contract along
    return this.orchestrator.runWithContract(input, taskContract);
  }

  /**
   * CHAT is a single tool-free model turn. It bypasses the engineering orchestrator, so it
   * publishes its own status and terminal events; the VS Code session and webview receive the
   * reply exclusively through task.completed.finalText. Model reliability (timeouts, retries,
   * model_request.* events) comes from the same ModelRequestManager the orchestrator uses.
   */
  private async handleChat(input: AgentKernelInput): Promise<AgentResult> {
    const emitStatus = (status: string) => input.onEvent({
      type: "agent.status",
      eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      taskId: input.taskId,
      timestamp: new Date().toISOString(),
      status
    });

    emitStatus("THINKING");

    const model = this.orchestrator.getModel();
    if (!model || typeof model.generate !== "function") {
      const error = "CHAT requires a configured model provider; none is available for this task.";
      emitStatus("FAILED");
      input.onEvent({
        type: "task.failed",
        eventId: `evt-${Date.now()}-failed`,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        error,
        payload: { code: "NO_MODEL_PROVIDER", message: error }
      });
      return { status: "failed", steps: 0, error };
    }

    const workspaceHint = input.workspaceRoot ? ` The user's open workspace folder is named "${basename(input.workspaceRoot)}".` : "";
    const requestManager = new ModelRequestManager(model, input.onEvent);

    try {
      const response = await requestManager.execute(
        input.taskId,
        input.runId,
        {
          prompt: input.userPrompt,
          systemPrompt: `${input.systemPrompt ? input.systemPrompt + "\n\n" : ""}${CHAT_SYSTEM_PROMPT}${workspaceHint}`,
          messages: [{ role: "user", content: input.userPrompt }]
          // no tools: CHAT never executes anything
        },
        input.abortSignal
      );

      const finalText = (response.text || "").replace(/<(think|thought)>[\s\S]*?<\/\1>/gi, "").trim();

      emitStatus("COMPLETED");
      input.onEvent({
        type: "task.completed",
        eventId: `evt-${Date.now()}-completed`,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        finalText
      });
      return { status: "completed", steps: 1, finalText };
    } catch (err: any) {
      if (err instanceof ProviderCancelledError || input.abortSignal?.aborted) {
        emitStatus("CANCELLED");
        input.onEvent({
          type: "task.cancelled",
          eventId: `evt-${Date.now()}-cancelled`,
          taskId: input.taskId,
          timestamp: new Date().toISOString()
        });
        return { status: "cancelled", steps: 0 };
      }
      const error = err?.message || String(err);
      emitStatus("FAILED");
      input.onEvent({
        type: "task.failed",
        eventId: `evt-${Date.now()}-failed`,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        error,
        payload: { code: "CHAT_MODEL_ERROR", message: error }
      });
      return { status: "failed", steps: 0, error };
    }
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
