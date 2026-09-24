import { AgentState, OrchestratorContext, AgentResult } from "./interfaces.js";
import { TaskContract, permissionsFromContract, toolAllowedByContract, validateTaskContract } from "./interaction/task_contract.js";
import { SubagentType, TaskAutonomy } from "@comu/protocol";
import { ApprovalGate } from "./approval/approval_gate.js";
import { ModelProvider, ModelMessage, ToolDefinition, ModelRequestManager, RequestManagerConfig } from "@comu/model-core";
import { ProviderCancelledError } from "@comu/shared";
import { ToolExecutor, ToolRegistry, ToolContext, ToolCapability, neverAborted } from "@comu/tool-core";
import { DiffEngine, ChangeSet } from "@comu/diff-engine";
import { TaskPlanner, PlanStateManager } from "@comu/planning-engine";
import { VerificationEngine, WorkspaceIntegrityVerifier, VerificationRequirement } from "@comu/verification-engine";
import { Diagnostician } from "@comu/diagnostics-engine";
import { RepairEngine } from "@comu/repair-engine";
import { InteractionManager } from "./interaction_manager.js";
import { MemoryEngine } from "@comu/memory-engine";
import { SubagentManager } from "./subagent_manager.js";
import { WorkingSetManager, WorkingSet } from "@comu/context-engine";
import { buildTaskSystemPrompt, sessionHistory } from "./system_prompt.js";
import {
  TaskPlan,
  VerificationResult,
  FailureDiagnosis,
  WorkspaceIntegrityResult
} from "@comu/protocol";

const MAX_TOOL_TARGET_CHARS = 160;

/** What verification means for one task: the contract's requirement, and the checks before any change. */
interface TaskVerificationContext {
  requirement: VerificationRequirement;
  baseline?: VerificationResult;
}

/**
 * What the agent last said, without its reasoning markup. Carried on a failed result too: a failed
 * turn is still part of the conversation, and the next message is often "why did that fail",
 * asked of this report.
 */
function spokenText(text: string | undefined): string | undefined {
  const clean = text?.replace(/<(think|thought)>[\s\S]*?<\/\1>/gi, "").trim();
  return clean || undefined;
}

/**
 * Why a verification result stops a task, as a typed code and a sentence.
 *
 * A required check that could not run is reported as exactly that. It used to reach the task
 * outcome as a failed check, so "could not run" read as "failed". Both places a task can be stopped
 * by verification (a VALIDATE step and the completion gate) say it the same way.
 */
function describeVerificationStop(result: VerificationResult): { code: string; message: string } {
  if (result.status === "UNAVAILABLE") {
    const names = result.checks.filter(c => c.required && c.status === "UNAVAILABLE").map(c => c.name);
    return {
      code: "VERIFICATION_UNAVAILABLE",
      message: `Verification could not run: ${names.join(", ") || "a required check"} could not be run for this project, so the change is unchecked.`
    };
  }
  return {
    code: "VERIFICATION_FAILED",
    message: `Required verification checks did not pass (status: ${result.status}): ${result.summary}`
  };
}

/**
 * The one bounded string that says what a tool call is about.
 *
 * Tool events used to carry the tool's name and nothing else, so an interface could only report
 * that a tool ran, never what it ran on. This publishes the single argument a person would name if
 * asked what the agent just did — the path, the query, the command line — and nothing else:
 * carrying the whole argument object would put file content into the event stream.
 */
export function describeToolTarget(tool: string, args: any): string | undefined {
  if (!args || typeof args !== "object") return undefined;

  let raw: unknown;
  if (tool === "execute_command") {
    raw = [args.executable, ...(Array.isArray(args.args) ? args.args : [])].filter(Boolean).join(" ");
  } else if (tool === "delegate_subtask") {
    raw = args.goal ?? args.type;
  } else {
    raw = args.path ?? args.query ?? args.pattern ?? args.directory ?? args.url;
  }

  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const value = raw.trim();
  return value.length > MAX_TOOL_TARGET_CHARS ? `${value.slice(0, MAX_TOOL_TARGET_CHARS)}...` : value;
}

export function formatStepSummary(text?: string, maxLen = 140): string | undefined {
  if (!text) return undefined;
  // Strip any inline <think>...</think> or <thought>...</thought>
  let cleaned = text.replace(/<(think|thought)>[\s\S]*?<\/\1>/gi, "").trim();
  // Collapse whitespace/newlines to single spaces
  cleaned = cleaned.replace(/\s+/g, " ");
  if (cleaned.length <= maxLen) {
    return cleaned;
  }
  // Truncate cleanly at word boundary
  const truncated = cleaned.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.7) {
    return `${truncated.slice(0, lastSpace)}...`;
  }
  return `${truncated}...`;
}

export class AgentOrchestrator {
  private state: AgentState = "IDLE";
  private planner: TaskPlanner;
  private verificationEngine: VerificationEngine;
  private repairEngine: RepairEngine;
  private interactionManager?: InteractionManager;
  private memoryEngine?: MemoryEngine;
  private subagentManager: SubagentManager;
  private requestManager?: ModelRequestManager;
  private workingSetManager: WorkingSetManager;

  constructor(
    private model: ModelProvider,
    private registry: ToolRegistry,
    private executor: ToolExecutor,
    private diffEngine: DiffEngine,
    options?: {
      planner?: TaskPlanner;
      verificationEngine?: VerificationEngine;
      repairEngine?: RepairEngine;
      interactionManager?: InteractionManager;
      memoryEngine?: MemoryEngine;
      subagentManager?: SubagentManager;
      requestManagerConfig?: RequestManagerConfig;
      workingSetManager?: WorkingSetManager;
    }
  ) {
    this.planner = options?.planner || new TaskPlanner();
    this.verificationEngine = options?.verificationEngine || new VerificationEngine();
    this.repairEngine = options?.repairEngine || new RepairEngine();
    this.interactionManager = options?.interactionManager;
    this.memoryEngine = options?.memoryEngine;
    this.subagentManager = options?.subagentManager || new SubagentManager();
    this.workingSetManager = options?.workingSetManager || new WorkingSetManager();
    // requestManager is lazily initialized per-task in runWithContract
  }

  public getWorkingSet(): WorkingSet {
    return this.workingSetManager.get();
  }

  /** The provider this orchestrator was constructed with. Used by the kernel for tool-free CHAT turns. */
  public getModel(): ModelProvider {
    return this.model;
  }

  /** The interaction manager, when the host wired one. The kernel uses it to ask for clarification. */
  public getInteractionManager(): InteractionManager | undefined {
    return this.interactionManager;
  }

  public getWorkingSetManager(): WorkingSetManager {
    return this.workingSetManager;
  }

  public getState(): AgentState {
    return this.state;
  }

  public transition(ctx: OrchestratorContext, newState: AgentState, message?: string, contract?: any) {
    const from = this.state;
    const to = newState;

    // Transition map
    const validTransitions: Record<AgentState, AgentState[]> = {
      IDLE: ["STARTING"],
      STARTING: ["CLASSIFYING", "ANALYZING", "CANCELLED", "FAILED"],
      CLASSIFYING: ["ANALYZING", "PLANNING", "THINKING", "WAITING_FOR_USER", "COMPLETED", "CANCELLED", "FAILED"],
      ANALYZING: ["PLANNING", "CANCELLED", "FAILED", "LIMIT_REACHED"],
      PLANNING: ["THINKING", "COMPLETED", "CANCELLED", "FAILED", "LIMIT_REACHED"],
      THINKING: ["TOOL_CALLING", "OBSERVING", "VERIFYING", "THINKING", "WAITING_FOR_USER", "COMPLETED", "CANCELLED", "FAILED", "LIMIT_REACHED"],
      TOOL_CALLING: ["WAITING_FOR_USER", "OBSERVING", "CANCELLED", "FAILED", "LIMIT_REACHED"],
      OBSERVING: ["VERIFYING", "THINKING", "COMPLETED", "CANCELLED", "FAILED", "LIMIT_REACHED"],
      VERIFYING: ["DIAGNOSING", "THINKING", "VERIFYING", "COMPLETED", "CANCELLED", "FAILED", "LIMIT_REACHED"],
      DIAGNOSING: ["REPAIRING", "FAILED", "CANCELLED", "LIMIT_REACHED"],
      REPAIRING: ["VERIFYING", "THINKING", "FAILED", "CANCELLED", "LIMIT_REACHED"],
      WAITING_FOR_USER: ["CLASSIFYING", "ANALYZING", "THINKING", "TOOL_CALLING", "OBSERVING", "CANCELLED", "FAILED", "LIMIT_REACHED"],
      COMPLETED: [],
      FAILED: [],
      CANCELLED: [],
      LIMIT_REACHED: []
    };

    if (!validTransitions[from]?.includes(to)) {
      throw new Error(`Invalid state transition from ${from} to ${to}`);
    }

    if (contract) {
      if (to === "TOOL_CALLING" && (contract.mode === "CHAT" || contract.mode === "PLAN")) {
        throw new Error(`Invalid state transition: ${contract.mode} mode cannot enter TOOL_CALLING`);
      }
      if (to === "REPAIRING" && contract.mode !== "AGENT") {
        throw new Error(`Invalid state transition: ${contract.mode} mode cannot enter REPAIRING`);
      }
    }

    this.state = to;
    ctx.onEvent({
      type: "agent.status",
      eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2)}`,
      taskId: ctx.taskId,
      timestamp: new Date().toISOString(),
      status: message || to,
      // Published alongside the message so a consumer never has to infer the state from wording.
      state: to
    });
  }

  public async run(ctx: OrchestratorContext): Promise<AgentResult> {
    const { AgentKernel } = await import("./agent_kernel.js");
    const kernel = new AgentKernel(this);
    return kernel.handle({
      taskId: ctx.taskId,
      runId: ctx.taskId,
      mode: ctx.mode,
      autonomy: ctx.autonomy,
      systemPrompt: ctx.systemPrompt,
      userPrompt: ctx.userPrompt,
      session: ctx.session,
      workspaceRoot: ctx.workspaceRoot,
      workspaceId: ctx.workspaceId,
      limits: ctx.limits,
      abortSignal: ctx.abortSignal,
      onEvent: ctx.onEvent,
      gitConfig: ctx.gitConfig,
      hasHumanObserver: ctx.hasHumanObserver
    });
  }

  public async runWithContract(ctx: OrchestratorContext, contract: TaskContract): Promise<AgentResult> {
    const startTime = Date.now();
    let steps = 0;
    let toolCallsCount = 0;
    let totalValidationRuns = 0;

    ctx.onEvent({
      type: "task.started",
      eventId: `evt-${Date.now()}`,
      taskId: ctx.taskId,
      timestamp: new Date().toISOString()
    });

    this.transition(ctx, "STARTING", "Initializing task", contract);

    const changeSet: ChangeSet = this.diffEngine.createChangeSet(ctx.taskId);

    // Model-originated tool calls run with exactly the capabilities the contract grants.
    const toolCtx: ToolContext = {
      taskId: ctx.taskId,
      workspace: { rootPath: ctx.workspaceRoot },
      limits: { maxResults: 100, maxBytes: 1000000 },
      permissions: permissionsFromContract(contract),
      // One cancellation mechanism, always present: an orchestrator context without a signal gets
      // one that never aborts rather than a tool silently losing the ability to stop.
      abortSignal: ctx.abortSignal ?? neverAborted()
    };

    // Verification, workspace-integrity checks and git governance are runtime-authoritative:
    // the runtime decides to run them, not the model, so they are not bound by the model's contract.
    // They still never write files and never reach the network.
    const runtimeToolCtx: ToolContext = {
      ...toolCtx,
      permissions: { capabilities: { read: "ALLOW", write: "DENY", execute: "ALLOW", network: "DENY" } }
    };

    // Human approval gate. Time spent waiting for a human is excluded from the execution budget.
    const autonomy: TaskAutonomy = ctx.autonomy || "ask";
    let waitingMs = 0;
    const elapsedMs = () => Date.now() - startTime - waitingMs;
    /*
     * Where the repair budget starts, on the same clock as elapsedMs.
     *
     * The budget is maxRepairTimeMs of repairing. It used to be handed the task's start, so it
     * measured the task's age instead: any task older than three minutes was refused every repair
     * with REPAIR_TIMEOUT and no attempt made, which was the largest failure class in B0. It starts
     * at the first failed verification considered for repair, and excludes time spent waiting on a
     * human, as the execution budget does.
     */
    let repairStartedAtMs: number | undefined;
    const approvalGate = new ApprovalGate({
      taskId: ctx.taskId,
      autonomy,
      workspaceRoot: ctx.workspaceRoot,
      interactionManager: this.interactionManager,
      onEvent: ctx.onEvent,
      abortSignal: ctx.abortSignal,
      hasHumanObserver: ctx.hasHumanObserver,
      observerGraceMs: ctx.limits.approvalObserverGraceMs,
      timeoutMs: ctx.limits.approvalTimeoutMs ?? 10 * 60 * 1000,
      createUnifiedDiff: (path, original, proposed) => this.diffEngine.createUnifiedDiff(path, original, proposed)
    });

    // CHAT and PLAN never enter TOOL_CALLING (state-machine invariant): offer no tools at all.
    const toolsEnabled = contract.mode !== "CHAT" && contract.mode !== "PLAN";
    const validateContract = (toolName: string, capabilities: ToolCapability[]) =>
      validateTaskContract(contract, toolName, capabilities);

    if (ctx.abortSignal?.aborted) {
      this.transition(ctx, "CANCELLED", "Task was cancelled");
      ctx.onEvent({
        type: "task.cancelled",
        eventId: `evt-${Date.now()}`,
        taskId: ctx.taskId,
        timestamp: new Date().toISOString()
      });
      return { status: "cancelled", steps: 0, changeSet };
    }

    // ==========================================
    // Phase 1: Task Analysis, Memory & Planning
    // ==========================================
    this.transition(ctx, "ANALYZING", "Analyzing task and workspace requirements");

    let memoryContext = "";
    if (this.memoryEngine) {
      try {
        const memRes = await this.memoryEngine.query({
          workspaceId: ctx.workspaceId || ctx.workspaceRoot,
          text: ctx.userPrompt,
          limit: 5
        });

        if (memRes.entries.length > 0) {
          ctx.onEvent({
            type: "memory.retrieved",
            eventId: `evt-${Date.now()}`,
            taskId: ctx.taskId,
            timestamp: new Date().toISOString(),
            query: { workspaceId: ctx.workspaceId || ctx.workspaceRoot, text: ctx.userPrompt },
            count: memRes.entries.length,
            topMatches: memRes.entries.map((e: any, idx: number) => ({
              id: e.id,
              type: e.type,
              score: memRes.explanations[idx]?.matchScore || 1.0
            }))
          });

          memoryContext = memRes.entries
            .map((e: any) => `[VERIFIED PROJECT ${e.type} (${e.trustLevel})]: ${e.content}`)
            .join("\n");
        }
      } catch {
        // Memory query failure does not block execution
      }
    }

    let currentPlan: TaskPlan;
    try {
      this.transition(ctx, "PLANNING", "Generating structured engineering plan");
      currentPlan = await this.planner.createPlan(ctx.taskId, ctx.userPrompt, ctx.abortSignal, {
        expectedMutation: contract.expectedMutation
      });
    } catch (planError: any) {
      if (ctx.abortSignal?.aborted) {
        this.transition(ctx, "CANCELLED", "Task was cancelled");
        ctx.onEvent({
          type: "task.cancelled",
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString()
        });
        return { status: "cancelled", steps: 0, changeSet };
      }
      this.transition(ctx, "FAILED", `Planning error: ${planError.message}`);
      ctx.onEvent({
        type: "task.failed",
        error: planError.message,
        eventId: `evt-${Date.now()}`,
        taskId: ctx.taskId,
        timestamp: new Date().toISOString()
      });
      return { status: "failed", error: planError.message, steps, changeSet };
    }

    ctx.onEvent({
      type: "plan.created",
      eventId: `evt-${Date.now()}`,
      taskId: ctx.taskId,
      timestamp: new Date().toISOString(),
      planId: currentPlan.planId,
      planVersion: currentPlan.version,
      plan: currentPlan
    });

    let planManager = new PlanStateManager(currentPlan);

    const initialPrompt = memoryContext
      ? `${ctx.userPrompt}\n\n[SUPPLEMENTARY PROJECT KNOWLEDGE - Active workspace files remain authoritative]:\n${memoryContext}`
      : ctx.userPrompt;

    // Earlier turns go in as the messages they were, so a correction in this turn lands against what
    // the model actually said last time rather than against a description of it.
    const messages: ModelMessage[] = [...sessionHistory(ctx.session), { role: "user", content: initialPrompt }];

    // Defence in depth: a read-only task is never even offered a mutating tool. Enforcement below
    // catches the model naming one anyway.
    const tools: ToolDefinition[] = toolsEnabled
      ? this.registry
          .getAll()
          .filter(t => toolAllowedByContract(contract, t))
          .map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
          }))
      : [];

    if (toolsEnabled && contract.allowedCapabilities.includes("read")) tools.push({
      name: "delegate_subtask",
      description: "Delegate a bounded read-only investigation (RESEARCH) or verification task to a supervised worker agent.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["RESEARCH", "VERIFICATION"], description: "Type of worker subagent" },
          goal: { type: "string", description: "Focused goal for the worker agent" }
        },
        required: ["type", "goal"]
      }
    });

    let lastVerification: VerificationResult | undefined;
    let lastDiagnosis: FailureDiagnosis | undefined;
    let lastAssistantText: string | undefined;

    // What the model is told about where it is and what it may do, built from what this task can
    // actually do. Anything the host adds follows it.
    const systemPrompt = [
      buildTaskSystemPrompt({
        workspaceRoot: ctx.workspaceRoot,
        autonomy,
        tools: tools.map(t => t.name),
        expectedMutation: contract.expectedMutation,
        session: ctx.session
      }),
      ctx.systemPrompt?.trim()
    ]
      .filter(Boolean)
      .join("\n\n");

    /*
     * What verification means for this task comes from the contract, not the prompt (decision
     * 0017). A task expected to change code also records its required checks once, before anything
     * is changed: a check that passed then and passes after is not evidence of the change.
     */
    const verification: TaskVerificationContext = {
      requirement: { expectedMutation: contract.expectedMutation, verificationRequired: contract.verificationRequired }
    };
    if (contract.expectedMutation && contract.verificationRequired && !ctx.abortSignal?.aborted) {
      verification.baseline = await this.verificationEngine.runVerification({
        taskId: ctx.taskId,
        workspaceRoot: ctx.workspaceRoot,
        changedFiles: [],
        requirement: verification.requirement,
        toolExecutor: this.executor,
        toolContext: runtimeToolCtx,
        abortSignal: ctx.abortSignal
      });
    }

    // ==========================================
    // Phase 2: Active Orchestration Loop
    // ==========================================
    while (true) {
      if (ctx.abortSignal?.aborted) {
        this.transition(ctx, "CANCELLED", "Task was cancelled");
        ctx.onEvent({
          type: "task.cancelled",
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString()
        });
        return { status: "cancelled", steps, changeSet, plan: planManager.getPlan() };
      }

      if (steps >= ctx.limits.maxSteps) {
        this.transition(ctx, "LIMIT_REACHED", `Max steps (${ctx.limits.maxSteps}) reached`);
        ctx.onEvent({
          type: "agent.limit_reached",
          limit: "maxSteps",
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString()
        });
        return { status: "limit_reached", steps, changeSet, plan: planManager.getPlan() };
      }

      if (elapsedMs() > ctx.limits.maxExecutionTimeMs) {
        this.transition(ctx, "LIMIT_REACHED", "Max execution time reached");
        ctx.onEvent({
          type: "agent.limit_reached",
          limit: "maxExecutionTimeMs",
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString()
        });
        return { status: "limit_reached", steps, changeSet, plan: planManager.getPlan() };
      }

      // Check current plan step eligibility:
      // First check if there is an already RUNNING step (e.g., in a multi-turn step)
      let currentStep = planManager.getActiveStep();
      if (!currentStep) {
        const eligibleSteps = planManager.getEligibleSteps();
        currentStep = eligibleSteps[0];

        if (currentStep) {
          planManager.startStep(currentStep.id);
          ctx.onEvent({
            type: "plan.step.started",
            eventId: `evt-${Date.now()}`,
            taskId: ctx.taskId,
            timestamp: new Date().toISOString(),
            planId: planManager.getPlan().planId,
            planVersion: planManager.getPlan().version,
            stepId: currentStep.id
          });
        }
      }

      // If no steps are eligible and none are running, check if all steps finished
      if (!currentStep) {
        const remainingSteps = planManager.getPlan().steps.filter(
          s => s.status === "PENDING" || s.status === "RUNNING"
        );
        if (remainingSteps.length === 0) {
          return await this.evaluateCompletionGate(
            ctx,
            planManager,
            changeSet,
            lastVerification,
            startTime + waitingMs,
            steps,
            runtimeToolCtx,
            lastAssistantText,
            verification
          );
        }
      }

      // If the current step is a VALIDATE step, trigger VerificationEngine directly
      if (currentStep && currentStep.type === "VALIDATE") {
        this.transition(ctx, "VERIFYING", "Executing verification checks");
        totalValidationRuns++;

        const changedFiles = Array.from(changeSet.changes.keys());
        ctx.onEvent({
          type: "verification.started",
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString(),
          verificationId: `vrun-${Date.now()}`
        });

        lastVerification = await this.verificationEngine.runVerification({
          taskId: ctx.taskId,
          workspaceRoot: ctx.workspaceRoot,
          changedFiles,
          changeSet,
          requirement: verification.requirement,
          baseline: verification.baseline,
          toolExecutor: this.executor,
          toolContext: runtimeToolCtx,
          abortSignal: ctx.abortSignal
        });

        ctx.onEvent({
          type: "verification.completed",
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString(),
          verificationId: lastVerification.verificationId,
          result: lastVerification
        });

        if (lastVerification.checks && lastVerification.checks.length > 0) {
          this.workingSetManager.updateDiagnostics(
            lastVerification.checks.map((c: any) => ({
              file: c.name || "verification",
              line: 1,
              message: c.message || c.status,
              severity: (c.status === "FAILED" ? "error" : "warning") as "error" | "warning"
            }))
          );
        }

        // NOT_VERIFIED is not a failure: there is nothing to diagnose or repair. The completion gate
        // carries it through to the result, where it is reported as unverified, never as passed.
        if (lastVerification.status === "PASSED" || lastVerification.status === "NOT_VERIFIED") {
          planManager.completeStep(currentStep.id, lastVerification.summary);
          ctx.onEvent({
            type: "plan.step.completed",
            eventId: `evt-${Date.now()}`,
            taskId: ctx.taskId,
            timestamp: new Date().toISOString(),
            planId: planManager.getPlan().planId,
            planVersion: planManager.getPlan().version,
            stepId: currentStep.id,
            resultSummary: lastVerification.summary
          });

          const remainingSteps = planManager.getPlan().steps.filter(
            s => s.status === "PENDING" || s.status === "RUNNING"
          );
          if (remainingSteps.length === 0) {
            return await this.evaluateCompletionGate(
              ctx,
              planManager,
              changeSet,
              lastVerification,
              startTime + waitingMs,
              steps,
              runtimeToolCtx,
              lastAssistantText,
              verification
            );
          }
          // Proceed to next step
          continue;
        } else {
          // Verification failed or unavailable
          planManager.failStep(currentStep.id, lastVerification.summary);
          ctx.onEvent({
            type: "plan.step.failed",
            eventId: `evt-${Date.now()}`,
            taskId: ctx.taskId,
            timestamp: new Date().toISOString(),
            planId: planManager.getPlan().planId,
            planVersion: planManager.getPlan().version,
            stepId: currentStep.id,
            error: lastVerification.summary
          });

          // Phase: Diagnosis & Repair
          const failedCheck =
            lastVerification.checks.find(c => c.status === "FAILED" || c.status === "UNAVAILABLE") ||
            lastVerification.checks[0];

          if (failedCheck && failedCheck.status === "FAILED") {
            this.transition(ctx, "DIAGNOSING", `Diagnosing failure in ${failedCheck.name}`);
            lastDiagnosis = Diagnostician.diagnose(ctx.taskId, failedCheck);

            ctx.onEvent({
              type: "diagnosis.created",
              eventId: `evt-${Date.now()}`,
              taskId: ctx.taskId,
              timestamp: new Date().toISOString(),
              diagnosisId: lastDiagnosis.diagnosisId,
              diagnosis: lastDiagnosis
            });

            // Evaluate Repair Eligibility
            repairStartedAtMs ??= elapsedMs();
            const repairDecision = this.repairEngine.evaluateRepair({
              taskId: ctx.taskId,
              diagnosis: lastDiagnosis,
              proposedTargetFiles: lastDiagnosis.affectedFiles,
              existingChangedFiles: Array.from(changeSet.changes.keys()),
              // The engine measures Date.now() - startTimeMs, so this is "now, minus time spent repairing".
              startTimeMs: Date.now() - (elapsedMs() - repairStartedAtMs),
              totalValidationRuns,
              limits: {
                maxRepairAttempts: ctx.limits.maxRepairAttempts,
                maxValidationRuns: ctx.limits.maxValidationRuns,
                maxRepairFiles: ctx.limits.maxRepairFiles,
                maxRepairTimeMs: ctx.limits.maxRepairTimeMs
              }
            });

            if (repairDecision.eligible) {
              const attemptNumber = this.repairEngine.getAttempts(ctx.taskId).length + 1;
              this.repairEngine.recordAttempt({
                attemptId: `rep-${Date.now()}-${attemptNumber}`,
                taskId: ctx.taskId,
                attemptNumber,
                failureFingerprint: lastDiagnosis.failureFingerprint,
                repairStrategyFingerprint: repairDecision.repairStrategyFingerprint || "unknown-strategy",
                repairAttemptFingerprint: `attempt-${attemptNumber}`,
                targetFiles: repairDecision.targetFiles,
                changeSummary: `Repair attempt ${attemptNumber} for ${lastDiagnosis.failureType}`,
                validationStatus: "FAILED",
                createdAt: new Date().toISOString()
              });

              this.transition(ctx, "REPAIRING", `Repairing failure in ${repairDecision.targetFiles.join(", ")}`);
              
              // Dynamically mutate plan
              const mutatedPlan = this.planner.createRepairPlan(
                planManager.getPlan(),
                currentStep.id,
                lastDiagnosis.summary,
                repairDecision.targetFiles
              );

              planManager = new PlanStateManager(mutatedPlan);
              ctx.onEvent({
                type: "plan.updated",
                eventId: `evt-${Date.now()}`,
                taskId: ctx.taskId,
                timestamp: new Date().toISOString(),
                planId: mutatedPlan.planId,
                planVersion: mutatedPlan.version,
                plan: mutatedPlan,
                mutationReason: `Remediating failure: ${lastDiagnosis.summary}`
              });

              // Add repair guidance to model context
              messages.push({
                role: "user",
                content: `[VERIFICATION FAILURE DIAGNOSIS]\n${lastDiagnosis.summary}\nAffected files: ${lastDiagnosis.affectedFiles.join(", ")}\nPlease implement targeted fixes to resolve this failure.`
              });

              // Continue loop to execute repair steps
              continue;
            } else {
              // Repair ineligible (duplicate repair strategy or repair limits reached)
              const reason = repairDecision.reason;
              if (reason.includes("DUPLICATE_REPAIR_STRATEGY")) {
                this.transition(ctx, "LIMIT_REACHED", reason);
                ctx.onEvent({
                  type: "agent.limit_reached",
                  limit: "duplicateRepairStrategy",
                  eventId: `evt-${Date.now()}`,
                  taskId: ctx.taskId,
                  timestamp: new Date().toISOString()
                });
                return {
                  status: "limit_reached",
                  error: reason,
                  steps,
                  changeSet,
                  plan: planManager.getPlan(),
                  verificationResult: lastVerification,
                  diagnosis: lastDiagnosis,
                  repairAttempts: this.repairEngine.getAttempts(ctx.taskId)
                };
              } else {
                this.transition(ctx, "FAILED", reason);
                ctx.onEvent({
                  type: "task.failed",
                  error: reason,
                  eventId: `evt-${Date.now()}`,
                  taskId: ctx.taskId,
                  timestamp: new Date().toISOString()
                });
                return {
                  status: "failed",
                  error: reason,
                  finalText: spokenText(lastAssistantText),
                  steps,
                  changeSet,
                  plan: planManager.getPlan(),
                  verificationResult: lastVerification,
                  diagnosis: lastDiagnosis,
                  repairAttempts: this.repairEngine.getAttempts(ctx.taskId)
                };
              }
            }
          } else {
            // Unavailable required check or other non-recoverable error
            const stop = describeVerificationStop(lastVerification);
            const errSummary = stop.message;
            this.transition(ctx, "FAILED", errSummary);
            ctx.onEvent({
              type: "task.failed",
              error: errSummary,
              payload: stop,
              eventId: `evt-${Date.now()}`,
              taskId: ctx.taskId,
              timestamp: new Date().toISOString()
            });
            return {
              status: "failed",
              error: errSummary,
              finalText: spokenText(lastAssistantText),
              steps,
              changeSet,
              plan: planManager.getPlan(),
              verificationResult: lastVerification
            };
          }
        }
      }

      // Step execution via Model (through ModelRequestManager reliability boundary)
      this.transition(ctx, "THINKING", "Thinking...");
      steps++;

      // Initialize requestManager lazily per-task to bind onEvent
      if (!this.requestManager) {
        this.requestManager = new ModelRequestManager(this.model, ctx.onEvent, {
          modelRequestTimeoutMs: ctx.limits.modelRequestTimeoutMs
        });
      }

      let response;
      try {
        response = await this.requestManager.execute(
          ctx.taskId,
          ctx.taskId, // runId
          {
            prompt: ctx.userPrompt,
            systemPrompt,
            messages,
            tools
          },
          ctx.abortSignal
        );
      } catch (err: any) {
        // Provider cancellation -> task cancellation, not failure
        if (err instanceof ProviderCancelledError || ctx.abortSignal?.aborted) {
          this.transition(ctx, "CANCELLED", "Task was cancelled");
          ctx.onEvent({
            type: "task.cancelled",
            eventId: `evt-${Date.now()}`,
            taskId: ctx.taskId,
            timestamp: new Date().toISOString()
          });
          return { status: "cancelled", steps, changeSet, plan: planManager.getPlan() };
        }
        // Provider failure -> clean task failure (never DIAGNOSING/REPAIRING)
        this.transition(ctx, "FAILED", `Provider Error: ${err.message}`);
        ctx.onEvent({
          type: "task.failed",
          error: err.message,
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString()
        });
        return { status: "failed", error: err.message, finalText: spokenText(lastAssistantText), steps, changeSet, plan: planManager.getPlan() };
      }

      if (response.text && response.text !== "Default completion") {
        lastAssistantText = response.text;
      } else if (!lastAssistantText && response.text) {
        lastAssistantText = response.text;
      }

      messages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls
      });

      // If no tool calls, check completion gate
      if (!response.toolCalls || response.toolCalls.length === 0) {
        if (currentStep) {
          const summary = formatStepSummary(response.text);
          planManager.completeStep(currentStep.id, summary);
          ctx.onEvent({
            type: "plan.step.completed",
            eventId: `evt-${Date.now()}`,
            taskId: ctx.taskId,
            timestamp: new Date().toISOString(),
            planId: planManager.getPlan().planId,
            planVersion: planManager.getPlan().version,
            stepId: currentStep.id,
            resultSummary: summary
          });
        }

        // Only evaluate completion gate if all plan steps are finished
        const remainingSteps = planManager.getPlan().steps.filter(
          s => s.status === "PENDING" || s.status === "RUNNING"
        );
        if (remainingSteps.length > 0) {
          continue;
        }

        return await this.evaluateCompletionGate(
          ctx,
          planManager,
          changeSet,
          lastVerification,
          startTime + waitingMs,
          steps,
          runtimeToolCtx,
          lastAssistantText,
          verification
        );
      }

      // A mode without tools (PLAN, CHAT) never enters TOOL_CALLING. If the model produced tool
      // calls anyway, answer each with an error and let it continue in text.
      if (!toolsEnabled) {
        for (const tc of response.toolCalls) {
          const error = `TOOLS_UNAVAILABLE: Tools cannot be executed in ${contract.mode} mode. Respond in text.`;
          ctx.onEvent({
            type: "tool.completed",
            tool: tc.name,
            target: describeToolTarget(tc.name, tc.arguments),
            toolCallId: tc.id,
            result: { error },
            eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            taskId: ctx.taskId,
            timestamp: new Date().toISOString()
          });
          messages.push({ role: "tool", content: `ERROR: ${error}`, toolCallId: tc.id });
        }
        this.transition(ctx, "OBSERVING", "Observing results");
        continue;
      }

      // Execute tool calls
      this.transition(ctx, "TOOL_CALLING", "Executing tools...", contract);

      for (const tc of response.toolCalls) {
        toolCallsCount++;
        if (toolCallsCount > ctx.limits.maxToolCalls) {
          this.transition(ctx, "LIMIT_REACHED", `Max tool calls (${ctx.limits.maxToolCalls}) reached`);
          ctx.onEvent({
            type: "agent.limit_reached",
            limit: "maxToolCalls",
            eventId: `evt-${Date.now()}`,
            taskId: ctx.taskId,
            timestamp: new Date().toISOString()
          });
          return { status: "limit_reached", steps, changeSet, plan: planManager.getPlan() };
        }

        ctx.onEvent({
          type: "tool.started",
          tool: tc.name,
          target: describeToolTarget(tc.name, tc.arguments),
          toolCallId: tc.id,
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString()
        });

        let toolResultStr = "";
        let result: any;
        try {
          if (tc.name === "delegate_subtask") {
            const workerType = tc.arguments?.type as SubagentType;
            const workerCaps = SubagentManager.getWorkerCapabilities(workerType)?.allowedCapabilities as ToolCapability[] | undefined;
            if (!workerCaps) {
              throw new Error(`CONTRACT_REJECTED: Unknown worker type '${String(tc.arguments?.type)}'.`);
            }
            const delegation = validateContract("delegate_subtask", workerCaps);
            if (!delegation.valid) {
              throw new Error(`CONTRACT_REJECTED: ${delegation.reason}`);
            }

            ctx.onEvent({
              type: "subagent.started",
              eventId: `evt-${Date.now()}`,
              taskId: ctx.taskId,
              timestamp: new Date().toISOString(),
              subagentId: `sub-${Date.now()}`,
              subagentType: tc.arguments.type,
              goal: tc.arguments.goal
            });

            const subResult = await this.subagentManager.executeSubagent({
              parentTaskId: ctx.taskId,
              type: tc.arguments.type,
              depth: 1,
              goal: tc.arguments.goal,
              parentSignal: ctx.abortSignal,
              model: this.model,
              registry: this.registry,
              executor: this.executor,
              toolContext: toolCtx,
              onEvent: ctx.onEvent
            });

            steps += subResult.usage.steps;
            toolCallsCount += subResult.usage.toolCalls;

            if (subResult.status === "COMPLETED") {
              ctx.onEvent({
                type: "subagent.completed",
                eventId: `evt-${Date.now()}`,
                taskId: ctx.taskId,
                timestamp: new Date().toISOString(),
                subagentId: subResult.subagentId,
                subagentType: tc.arguments.type,
                result: subResult
              });
            } else {
              ctx.onEvent({
                type: "subagent.failed",
                eventId: `evt-${Date.now()}`,
                taskId: ctx.taskId,
                timestamp: new Date().toISOString(),
                subagentId: subResult.subagentId,
                subagentType: tc.arguments.type,
                error: subResult.error || "Subagent execution failed"
              });
            }

            result = subResult;
            toolResultStr = JSON.stringify(subResult);
          } else {
            const isMutating = tc.name === "create_file" || tc.name === "write_file" || tc.name === "edit_file";
            let baselineContent: string | undefined;
            let baselineHash: string | undefined;
            let baselineExists = false;

            if (isMutating) {
              const targetPath = tc.arguments.path as string;
              const existingRecord = changeSet.changes.get(targetPath);

              if (!existingRecord || existingRecord.originalContent === undefined) {
                try {
                  const readRes = (await this.executor.execute("read_file", { path: targetPath }, toolCtx)) as any;
                  baselineContent = readRes.content;
                  baselineHash = readRes.hash;
                  baselineExists = true;
                } catch (e) {
                  baselineExists = false;
                }
              } else {
                baselineContent = existingRecord.originalContent;
                baselineHash = existingRecord.originalHash;
                baselineExists = true;
              }
            }

            if (ctx.abortSignal?.aborted) {
              this.transition(ctx, "CANCELLED", "Task was cancelled");
              ctx.onEvent({
                type: "task.cancelled",
                eventId: `evt-${Date.now()}`,
                taskId: ctx.taskId,
                timestamp: new Date().toISOString()
              });
              return { status: "cancelled", steps, changeSet, plan: planManager.getPlan() };
            }

            let toolError: any = null;

            // Human approval gate (autonomy 'ask', or tools marked requiresApproval: "always").
            // The baseline read above supplies the pre-mutation content for the diff.
            let registeredTool: { name: string; capabilities: ToolCapability[]; requiresApproval?: "always" | "byAutonomy" } | undefined;
            try {
              registeredTool = this.registry.get(tc.name);
            } catch {
              registeredTool = undefined; // unknown tool: processModelToolCall reports it
            }
            if (registeredTool && approvalGate.requiresApproval(registeredTool)) {
              const payload = approvalGate.buildPayload(registeredTool, tc.arguments, { exists: baselineExists, content: baselineContent });
              const covered = approvalGate.findGrant(payload);
              if (!covered) {
                this.transition(ctx, "WAITING_FOR_USER", `Waiting for approval: ${payload.summary}`);
              }
              const waitStart = Date.now();
              let decision;
              try {
                decision = await approvalGate.decide(payload);
              } catch (e: any) {
                waitingMs += Date.now() - waitStart;
                if (ctx.abortSignal?.aborted || /cancel/i.test(e?.message || "")) {
                  this.transition(ctx, "CANCELLED", "Task was cancelled");
                  ctx.onEvent({
                    type: "task.cancelled",
                    eventId: `evt-${Date.now()}`,
                    taskId: ctx.taskId,
                    timestamp: new Date().toISOString()
                  });
                  return { status: "cancelled", steps, changeSet, plan: planManager.getPlan() };
                }
                decision = { approved: false, reason: "DENIED", message: e?.message || String(e) };
              }
              waitingMs += Date.now() - waitStart;
              if (!covered) {
                this.transition(ctx, "TOOL_CALLING", "Executing tools...", contract);
              }
              if (!decision.approved) {
                toolError = new Error(`APPROVAL_DENIED: ${decision.message} You may propose a different approach or ask the user how to proceed.`);
              }
            }

            // The single enforcement point for model-originated calls: parse, contract, permissions, execute.
            if (!toolError) {
              try {
                const outcome = await this.executor.processModelToolCall(tc, validateContract, toolCtx);
                if (outcome.type === "success") {
                  result = outcome.result;
                } else {
                  toolError = new Error(outcome.error || `Tool ${tc.name} returned ${outcome.type}`);
                }
              } catch (e) {
                toolError = e;
              }
            }

            if (ctx.abortSignal?.aborted || (toolError && (toolError.name === "AbortError" || String(toolError).includes("COMMAND_CANCELLED") || String(toolError).includes("CANCELLED")))) {
              this.transition(ctx, "CANCELLED", "Task was cancelled");
              ctx.onEvent({
                type: "task.cancelled",
                eventId: `evt-${Date.now()}`,
                taskId: ctx.taskId,
                timestamp: new Date().toISOString()
              });
              return { status: "cancelled", steps, changeSet, plan: planManager.getPlan() };
            }

            if (isMutating) {
              const targetPath = tc.arguments.path as string;
              let finalContent: string | undefined;
              let finalHash: string | undefined;
              let finalExists = false;
              let readError: any = null;

              try {
                const readRes = (await this.executor.execute("read_file", { path: targetPath }, toolCtx)) as any;
                finalContent = readRes.content;
                finalHash = readRes.hash;
                finalExists = true;
              } catch (e) {
                readError = e;
                finalExists = false;
              }

              if (toolError) {
                const changed = baselineExists !== finalExists || baselineHash !== finalHash;
                if (changed) {
                  if (readError && !baselineExists) {
                    this.transition(ctx, "FAILED", "Mutation failed and workspace state cannot be verified.");
                    ctx.onEvent({
                      type: "task.failed",
                      error: "Workspace state unknown",
                      payload: { code: "WORKSPACE_STATE_UNKNOWN", message: "Failed to verify state after tool error" },
                      eventId: `evt-${Date.now()}`,
                      taskId: ctx.taskId,
                      timestamp: new Date().toISOString()
                    });
                    return { status: "failed", error: "WORKSPACE_STATE_UNKNOWN", finalText: spokenText(lastAssistantText), steps, changeSet, plan: planManager.getPlan() };
                  } else {
                    this.transition(ctx, "FAILED", "Integrity Error: Workspace mutated despite tool failure");
                    ctx.onEvent({
                      type: "task.failed",
                      error: "Workspace state changed after failure",
                      payload: { code: "WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE", message: toolError.message },
                      eventId: `evt-${Date.now()}`,
                      taskId: ctx.taskId,
                      timestamp: new Date().toISOString()
                    });
                    return { status: "failed", error: "WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE", finalText: spokenText(lastAssistantText), steps, changeSet, plan: planManager.getPlan() };
                  }
                }
                throw toolError;
              } else {
                const operation = tc.name === "create_file" && !baselineExists ? "CREATE" : "MODIFY";
                const newContent = finalContent || tc.arguments.content || "edited";
                this.diffEngine.recordChange(
                  changeSet,
                  targetPath,
                  operation,
                  newContent,
                  baselineContent,
                  baselineHash,
                  finalHash
                );
                // Counted against what was actually on disk, from the same diff the approval card
                // would have shown. A write that happened without an approval is otherwise the one
                // change nothing can report the size of.
                const counts = ApprovalGate.countChanges(
                  this.diffEngine.createUnifiedDiff(targetPath, baselineContent ?? "", newContent)
                );
                ctx.onEvent({
                  type: "change.created",
                  path: targetPath,
                  operation,
                  additions: counts.additions,
                  deletions: counts.deletions,
                  eventId: `evt-${Date.now()}`,
                  taskId: ctx.taskId,
                  timestamp: new Date().toISOString()
                });
              }
            } else if (toolError) {
              throw toolError;
            }

            toolResultStr = typeof result === "string" ? result : JSON.stringify(result);
          }
          ctx.onEvent({
            type: "tool.completed",
            tool: tc.name,
            target: describeToolTarget(tc.name, tc.arguments),
            toolCallId: tc.id,
            result,
            eventId: `evt-${Date.now()}`,
            taskId: ctx.taskId,
            timestamp: new Date().toISOString()
          });

          // Update working set tracking
          if (tc.name === "read_file" && result) {
            const content = typeof result === "string" ? result : result.content || "";
            const isTruncated = typeof result === "object" ? !!result.truncated : false;
            this.workingSetManager.addInspectedFile({ path: tc.arguments?.path, content, isTruncated });
          } else if (tc.name === "search_text" && result?.matches) {
            this.workingSetManager.addSearchResults(
              result.matches.map((m: any) => ({
                file: m.file || m.path,
                line: m.line || 1,
                content: m.lineContent || m.text || ""
              }))
            );
          } else if ((tc.name === "create_file" || tc.name === "write_file" || tc.name === "edit_file") && tc.arguments?.path) {
            this.workingSetManager.addModifiedFile({
              path: tc.arguments.path,
              source: "COMU_CHANGE",
              timestamp: new Date().toISOString()
            });
          }
        } catch (e: any) {
          toolResultStr = `ERROR: ${e.message}`;
          ctx.onEvent({
            type: "tool.completed",
            tool: tc.name,
            target: describeToolTarget(tc.name, tc.arguments),
            toolCallId: tc.id,
            result: { error: e.message },
            eventId: `evt-${Date.now()}`,
            taskId: ctx.taskId,
            timestamp: new Date().toISOString()
          });
        }

        messages.push({
          role: "tool",
          content: toolResultStr,
          toolCallId: tc.id
        });
      }

      this.transition(ctx, "OBSERVING", "Observing results");
    }
  }

  private async evaluateCompletionGate(
    ctx: OrchestratorContext,
    planManager: PlanStateManager,
    changeSet: ChangeSet,
    lastVerification: VerificationResult | undefined,
    startTime: number,
    steps: number,
    toolCtx: any,
    finalText: string | undefined,
    verification: TaskVerificationContext
  ): Promise<AgentResult> {
    this.transition(ctx, "VERIFYING", "Evaluating completion gate and workspace integrity");

    // Run final verification if not already passed
    if (!lastVerification || lastVerification.status !== "PASSED") {
      const changedFiles = Array.from(changeSet.changes.keys());
      lastVerification = await this.verificationEngine.runVerification({
        taskId: ctx.taskId,
        workspaceRoot: ctx.workspaceRoot,
        changedFiles,
        changeSet,
        requirement: verification.requirement,
        baseline: verification.baseline,
        toolExecutor: this.executor,
        toolContext: toolCtx,
        abortSignal: ctx.abortSignal
      });

      ctx.onEvent({
        type: "verification.completed",
        eventId: `evt-${Date.now()}`,
        taskId: ctx.taskId,
        timestamp: new Date().toISOString(),
        verificationId: lastVerification.verificationId,
        result: lastVerification
      });
    }

    // Verify Workspace Integrity
    const workspaceIntegrity: WorkspaceIntegrityResult =
      await WorkspaceIntegrityVerifier.verifyIntegrity(changeSet, this.executor, toolCtx);

    const implementationComplete = true;
    // "Nothing was checked" may complete, but only as itself: the result and the task.completed
    // event carry NOT_VERIFIED, so no consumer can read it as verified.
    const requiredVerificationPassed = lastVerification.status === "PASSED" || lastVerification.status === "NOT_VERIFIED";
    const noCriticalFailures = !lastVerification.checks.some(
      c => c.required && (c.status === "FAILED" || c.status === "UNAVAILABLE")
    );
    const workspaceIntegrityVerified = workspaceIntegrity.status === "VERIFIED";
    const noPendingInteraction = !this.interactionManager?.getPendingInteraction(ctx.taskId);
    const withinLimits = steps <= ctx.limits.maxSteps && Date.now() - startTime <= ctx.limits.maxExecutionTimeMs;
    const changeSetValid = changeSet.status !== "FAILED";
    const executionStateKnown = true;

    const passesCompletionGate =
      implementationComplete &&
      requiredVerificationPassed &&
      noCriticalFailures &&
      workspaceIntegrityVerified &&
      noPendingInteraction &&
      withinLimits &&
      changeSetValid &&
      executionStateKnown;

    if (passesCompletionGate) {
      // Completing is not the same as verifying. Only verified work is committed as "verified task
      // changes" or remembered as a verified lesson.
      const verified = lastVerification.status === "PASSED";

      // Git Governance Flow
      let gitCommitResult: any;
      let gitPushResult: any;

      if (verified && changeSet && changeSet.changes.size > 0) {
        const changedFiles = Array.from(changeSet.changes.keys());
        const commitMessageProposal = `feat(${changedFiles[0]?.split("/").pop()?.split(".")[0] || "core"}): complete verified task changes`;

        ctx.onEvent({
          type: "git.commit.proposed",
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString(),
          message: commitMessageProposal,
          files: changedFiles
        });

        if (ctx.gitConfig?.autoCommitVerifiedTasks) {
          try {
            const stageRes = (await this.executor.execute(
              "git_stage_files",
              { files: changedFiles },
              toolCtx
            )) as any;
            if (stageRes && stageRes.success) {
              ctx.onEvent({
                type: "git.stage.completed",
                eventId: `evt-${Date.now()}`,
                taskId: ctx.taskId,
                timestamp: new Date().toISOString(),
                stagedFiles: stageRes.stagedFiles || changedFiles,
                matchesChangeSet: true
              });

              const commitRes = (await this.executor.execute(
                "git_commit",
                { message: commitMessageProposal },
                toolCtx
              )) as any;
              if (commitRes && commitRes.success) {
                gitCommitResult = commitRes;
                ctx.onEvent({
                  type: "git.commit.completed",
                  eventId: `evt-${Date.now()}`,
                  taskId: ctx.taskId,
                  timestamp: new Date().toISOString(),
                  commitHash: commitRes.commitHash || "HEAD",
                  message: commitMessageProposal,
                  branch: commitRes.branch || "main",
                  fileCount: changedFiles.length
                });
              }
            }
          } catch {
            // Git failure does not invalidate completion gate
          }
        }
      }

      // Memory Recording Flow
      if (this.memoryEngine) {
        try {
          await this.memoryEngine.recordEpisode({
            episodeId: `ep-${ctx.taskId}-${Date.now()}`,
            taskId: ctx.taskId,
            workspaceId: ctx.workspaceId || ctx.workspaceRoot,
            goal: ctx.userPrompt,
            summary: finalText || `Task completed in ${steps} steps`,
            changes: Array.from(changeSet.changes.entries()).map(([path, record]) => ({
              path,
              operation: record.operation
            })),
            verificationStatus: lastVerification.status,
            outcome: "COMPLETED",
            createdAt: new Date().toISOString(),
            evidenceReferences: [lastVerification.verificationId]
          });

          if (verified && changeSet.changes.size > 0) {
            const changedFiles = Array.from(changeSet.changes.keys());
            const lessonContent = `Task '${ctx.userPrompt.slice(0, 80)}' verified across: ${changedFiles.join(", ")}`;
            const recorded = await this.memoryEngine.record({
              workspaceId: ctx.workspaceId || ctx.workspaceRoot,
              type: "LESSON",
              content: lessonContent,
              source: "VERIFICATION",
              trustLevel: "TASK_VERIFIED",
              confidence: 0.9,
              status: "ACTIVE",
              scope: {
                workspaceId: ctx.workspaceId || ctx.workspaceRoot,
                files: changedFiles
              },
              evidence: {
                taskId: ctx.taskId,
                files: changedFiles,
                verificationIds: [lastVerification.verificationId]
              }
            });

            ctx.onEvent({
              type: "memory.recorded",
              eventId: `evt-${Date.now()}`,
              taskId: ctx.taskId,
              timestamp: new Date().toISOString(),
              entry: recorded
            });
          }
        } catch {
          // Memory persistence failure does not block completion
        }
      }

      const cleanFinalText = finalText ? finalText.replace(/<(think|thought)>[\s\S]*?<\/\1>/gi, "").trim() : undefined;

      this.transition(ctx, "COMPLETED", verified ? "Task verified and completed" : "Task completed, not verified");
      ctx.onEvent({
        type: "task.completed",
        eventId: `evt-${Date.now()}`,
        taskId: ctx.taskId,
        timestamp: new Date().toISOString(),
        finalText: cleanFinalText,
        verification: lastVerification.status
      });
      return {
        status: "completed",
        finalText: cleanFinalText,
        steps,
        changeSet,
        plan: planManager.getPlan(),
        verificationResult: lastVerification,
        workspaceIntegrity,
        gitCommitResult,
        gitPushResult
      };
    } else {
      let gateFailureReason = "Completion gate invariant check failed.";
      let gateFailureCode = "COMPLETION_GATE_FAILED";
      if (!requiredVerificationPassed) {
        ({ code: gateFailureCode, message: gateFailureReason } = describeVerificationStop(lastVerification));
      } else if (!workspaceIntegrityVerified) {
        gateFailureReason = `Workspace integrity verification failed: ${workspaceIntegrity.details || "conflict detected"}`;
      }

      if (this.memoryEngine) {
        try {
          await this.memoryEngine.recordEpisode({
            episodeId: `ep-${ctx.taskId}-${Date.now()}`,
            taskId: ctx.taskId,
            workspaceId: ctx.workspaceId || ctx.workspaceRoot,
            goal: ctx.userPrompt,
            summary: gateFailureReason,
            changes: Array.from(changeSet.changes.entries()).map(([path, record]) => ({
              path,
              operation: record.operation
            })),
            verificationStatus: lastVerification ? lastVerification.status : "FAILED",
            outcome: "FAILED",
            createdAt: new Date().toISOString()
          });
        } catch {
          // Ignore memory recording failure on task failure
        }
      }

      this.transition(ctx, "FAILED", gateFailureReason);
      ctx.onEvent({
        type: "task.failed",
        error: gateFailureReason,
        payload: { code: gateFailureCode, message: gateFailureReason },
        eventId: `evt-${Date.now()}`,
        taskId: ctx.taskId,
        timestamp: new Date().toISOString()
      });
      return {
        status: "failed",
        error: gateFailureReason,
        finalText: spokenText(finalText),
        steps,
        changeSet,
        plan: planManager.getPlan(),
        verificationResult: lastVerification,
        workspaceIntegrity
      };
    }
  }
}

