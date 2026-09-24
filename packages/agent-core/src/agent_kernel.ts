import { AgentOrchestrator } from "./orchestrator.js";
import { IntentRouter, IntentClassification, RouterContext } from "./interaction/intent_router.js";
import type { InteractionMode } from "./interaction/interaction_modes.js";
import { TaskContract } from "./interaction/task_contract.js";
import { ClarificationHandler } from "./interaction/clarification_handler.js";
import { ModelIntentClassifier } from "./interaction/model_intent_classifier.js";
import { AgentResult } from "./interfaces.js";
import { AgentLimits, TaskMode, TASK_MODES, TaskAutonomy } from "@comu/protocol";
import { ToolCapability } from "@comu/tool-core";
import { ModelRequestManager } from "@comu/model-core";
import { ProviderCancelledError } from "@comu/shared";
import { basename } from "path";
import type { TurnContext } from "@comu/session-store";
import { sessionHistory, sessionSection } from "./system_prompt.js";

export const CHAT_SYSTEM_PROMPT =
  "You are COMU, an AI software engineer working inside VS Code. " +
  "This is a conversational turn: answer directly, concisely and helpfully. " +
  "You have no tools in this turn and cannot read or change files or run commands; " +
  "if the user wants work done in the repository, say what you would do and suggest switching to Agent, Plan or Ask mode. " +
  "Do not invent details about the workspace you cannot see.";

/**
 * What the router knows about the conversation: the previous turn's mode, and whether it changed
 * any files. Both come from the session; without one, a message is routed on its own words.
 */
function routerContext(input: AgentKernelInput): RouterContext {
  const previous = input.session?.previousTurn;
  return {
    activeTaskId: input.taskId,
    ...(previous?.mode ? { previousMode: previous.mode as InteractionMode, previousChangedFiles: previous.changedFiles } : {})
  };
}

export interface AgentKernelInput {
  taskId: string;
  runId: string;
  /** Explicit mode from the composer. Omitted or AUTO means classify. */
  mode?: TaskMode;
  /** Autonomy level. readonly forces a read-only contract regardless of mode. */
  autonomy?: TaskAutonomy;
  systemPrompt: string;
  userPrompt: string;
  /** The session this turn continues. Absent on a session's first turn. */
  session?: TurnContext;
  workspaceRoot: string;
  workspaceId?: string;
  limits: AgentLimits;
  abortSignal?: AbortSignal;
  onEvent: (event: any) => void;
  gitConfig?: any;
  /** Whether a human can currently see the task; consulted by the approval gate. */
  hasHumanObserver?: () => boolean;
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

    let classification: IntentClassification;
    try {
      classification = await this.resolveClassification(input);
    } catch (err: any) {
      if (input.abortSignal?.aborted) {
        return this.cancelled(input);
      }
      throw err;
    }

    this.emitModeResolved(input, classification);

    if (classification.mode === "AMBIGUOUS") {
      if (input.abortSignal?.aborted) {
        return this.cancelled(input);
      }

      input.onEvent({
        type: "agent.status",
        eventId: `evt-${Date.now()}`,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        status: "WAITING_FOR_USER"
      });

      const interactionManager = this.orchestrator.getInteractionManager();
      if (!interactionManager) {
        // No interaction channel wired by the host: report the question and stop.
        return {
          status: "waiting_for_user",
          steps: 0,
          finalText: this.clarificationHandler.generateClarificationRequest(input.userPrompt)
        };
      }

      const clarified = await this.askForClarification(input, interactionManager);
      if ("result" in clarified) {
        return clarified.result;
      }
      classification = clarified.classification;
      input = { ...input, userPrompt: clarified.userPrompt };
      this.emitModeResolved(input, classification);
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
          systemPrompt: [
            `${input.systemPrompt ? input.systemPrompt + "\n\n" : ""}${CHAT_SYSTEM_PROMPT}${workspaceHint}`,
            input.session ? sessionSection(input.session).text : ""
          ]
            .filter(Boolean)
            .join("\n\n"),
          messages: [...sessionHistory(input.session), { role: "user", content: input.userPrompt }]
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
   * Only AUTO (or an absent mode) goes through the IntentRouter, whose deterministic fast path
   * falls back to a cheap model classification before ever reporting AMBIGUOUS.
   */
  private async resolveClassification(input: AgentKernelInput): Promise<IntentClassification> {
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
    return this.router.routeWithFallback(
      input.userPrompt,
      routerContext(input),
      this.buildClassifier(input),
      { taskId: input.taskId, runId: input.runId },
      input.abortSignal
    );
  }

  private buildClassifier(input: AgentKernelInput): ModelIntentClassifier | undefined {
    const model = this.orchestrator.getModel();
    if (!model || typeof model.generate !== "function") return undefined;
    return new ModelIntentClassifier(model, input.onEvent);
  }

  private emitModeResolved(input: AgentKernelInput, classification: IntentClassification) {
    input.onEvent({
      type: "task.mode_resolved",
      eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}-mode`,
      taskId: input.taskId,
      timestamp: new Date().toISOString(),
      mode: classification.mode,
      source: classification.source,
      confidence: classification.confidence,
      reasons: classification.reasons
    });
  }

  private cancelled(input: AgentKernelInput): AgentResult {
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
    return { status: "cancelled", steps: 0 };
  }

  /**
   * One clarification round through the InteractionManager (an INPUT interaction the webview
   * already renders with option buttons). A chosen option maps straight to a mode; free text is
   * re-routed together with the original prompt. If it is still ambiguous after that, the task
   * proceeds in read-only ASK mode rather than asking again.
   */
  private async askForClarification(
    input: AgentKernelInput,
    interactionManager: import("./interaction_manager.js").InteractionManager
  ): Promise<{ classification: IntentClassification; userPrompt: string } | { result: AgentResult }> {
    let answer: string;
    try {
      answer = await interactionManager.requestInput(
        input.taskId,
        "Clarification needed",
        this.clarificationHandler.generateClarificationRequest(input.userPrompt),
        this.clarificationHandler.getOptions(),
        undefined,
        input.onEvent,
        input.abortSignal
      );
    } catch (err: any) {
      if (input.abortSignal?.aborted || /cancelled/i.test(err?.message || "")) {
        return { result: this.cancelled(input) };
      }
      const error = /USER_INPUT_TIMEOUT/.test(err?.message || "")
        ? "No clarification was received before the interaction expired."
        : (err?.message || String(err));
      input.onEvent({
        type: "agent.status",
        eventId: `evt-${Date.now()}`,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        status: "FAILED"
      });
      input.onEvent({
        type: "task.failed",
        eventId: `evt-${Date.now()}-failed`,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        error,
        payload: { code: "CLARIFICATION_TIMEOUT", message: error }
      });
      return { result: { status: "failed", steps: 0, error } };
    }

    const chosen = this.clarificationHandler.mapAnswerToMode(answer);
    const userPrompt = `${input.userPrompt}\n\n[User clarification]: ${answer}`;
    if (chosen) {
      return {
        classification: {
          mode: chosen,
          confidence: 1.0,
          source: "explicit",
          reasons: [`user chose "${answer}" when asked to clarify`],
          requiresClarification: false
        },
        userPrompt
      };
    }

    const rerouted = await this.router.routeWithFallback(
      userPrompt,
      routerContext(input),
      this.buildClassifier(input),
      { taskId: input.taskId, runId: input.runId },
      input.abortSignal
    );
    if (rerouted.mode !== "AMBIGUOUS") {
      return { classification: rerouted, userPrompt };
    }
    return {
      classification: {
        mode: "ASK",
        confidence: 0.5,
        source: "fallback",
        reasons: ["still ambiguous after clarification; proceeding read-only (ASK) rather than asking again"],
        requiresClarification: false
      },
      userPrompt
    };
  }

  private createContract(input: AgentKernelInput, classification: IntentClassification): TaskContract {
    let allowedCapabilities: ToolCapability[] = [];
    let expectedMutation = false;
    let verificationRequired = false;

    if (classification.mode === "ASK" || classification.mode === "PLAN") {
      // Read-only investigation. Network covers documentation lookups (web_docs); nothing mutates.
      allowedCapabilities = ["read", "network"];
    } else if (classification.mode === "AGENT") {
      allowedCapabilities = ["read", "write", "execute", "network"];
      expectedMutation = true;
      verificationRequired = true;
    }

    if (input.autonomy === "readonly") {
      // readonly autonomy wins over the mode: nothing may mutate or run, whatever was classified.
      allowedCapabilities = allowedCapabilities.filter(c => c === "read" || c === "network");
      expectedMutation = false;
      verificationRequired = false;
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
