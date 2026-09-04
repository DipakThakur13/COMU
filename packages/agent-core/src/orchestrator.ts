import { AgentState, OrchestratorContext, AgentResult } from "./interfaces.js";
import { ModelProvider, ModelMessage, ToolDefinition } from "@comu/model-core";
import { ToolExecutor, ToolRegistry, ToolContext } from "@comu/tool-core";
import { DiffEngine, ChangeSet } from "@comu/diff-engine";
import { TaskPlanner, PlanStateManager } from "@comu/planning-engine";
import { VerificationEngine, WorkspaceIntegrityVerifier } from "@comu/verification-engine";
import { Diagnostician } from "@comu/diagnostics-engine";
import { RepairEngine } from "@comu/repair-engine";
import { InteractionManager } from "./interaction_manager.js";
import { MemoryEngine } from "@comu/memory-engine";
import { SubagentManager } from "./subagent_manager.js";
import {
  TaskPlan,
  VerificationResult,
  FailureDiagnosis,
  RepairAttempt,
  RepairLimits,
  WorkspaceIntegrityResult,
  VerificationCheck
} from "@comu/protocol";

export class AgentOrchestrator {
  private state: AgentState = "IDLE";
  private planner: TaskPlanner;
  private verificationEngine: VerificationEngine;
  private repairEngine: RepairEngine;
  private interactionManager?: InteractionManager;
  private memoryEngine?: MemoryEngine;
  private subagentManager: SubagentManager;

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
    }
  ) {
    this.planner = options?.planner || new TaskPlanner();
    this.verificationEngine = options?.verificationEngine || new VerificationEngine();
    this.repairEngine = options?.repairEngine || new RepairEngine();
    this.interactionManager = options?.interactionManager;
    this.memoryEngine = options?.memoryEngine;
    this.subagentManager = options?.subagentManager || new SubagentManager();
  }

  public getState(): AgentState {
    return this.state;
  }

  private changeState(ctx: OrchestratorContext, newState: AgentState, message?: string) {
    this.state = newState;
    ctx.onEvent({
      type: "agent.status",
      eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2)}`,
      taskId: ctx.taskId,
      timestamp: new Date().toISOString(),
      status: message || newState
    });
  }

  public async run(ctx: OrchestratorContext): Promise<AgentResult> {
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

    this.changeState(ctx, "STARTING", "Initializing task");

    const changeSet: ChangeSet = this.diffEngine.createChangeSet(ctx.taskId);

    const toolCtx: ToolContext = {
      taskId: ctx.taskId,
      workspace: { rootPath: ctx.workspaceRoot },
      limits: { maxResults: 100, maxBytes: 1000000 },
      permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "DENY" } }
    };

    if (ctx.abortSignal?.aborted) {
      this.changeState(ctx, "CANCELLED", "Task was cancelled");
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
    this.changeState(ctx, "ANALYZING", "Analyzing task and workspace requirements");

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
      this.changeState(ctx, "PLANNING", "Generating structured engineering plan");
      currentPlan = await this.planner.createPlan(ctx.taskId, ctx.userPrompt, ctx.abortSignal);
    } catch (planError: any) {
      if (ctx.abortSignal?.aborted) {
        this.changeState(ctx, "CANCELLED", "Task was cancelled");
        ctx.onEvent({
          type: "task.cancelled",
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString()
        });
        return { status: "cancelled", steps: 0, changeSet };
      }
      this.changeState(ctx, "FAILED", `Planning error: ${planError.message}`);
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

    const messages: ModelMessage[] = [{ role: "user", content: initialPrompt }];

    const tools: ToolDefinition[] = this.registry.getAll().map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }));

    tools.push({
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

    // ==========================================
    // Phase 2: Active Orchestration Loop
    // ==========================================
    while (true) {
      if (ctx.abortSignal?.aborted) {
        this.changeState(ctx, "CANCELLED", "Task was cancelled");
        ctx.onEvent({
          type: "task.cancelled",
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString()
        });
        return { status: "cancelled", steps, changeSet, plan: planManager.getPlan() };
      }

      if (steps >= ctx.limits.maxSteps) {
        this.changeState(ctx, "LIMIT_REACHED", `Max steps (${ctx.limits.maxSteps}) reached`);
        ctx.onEvent({
          type: "agent.limit_reached",
          limit: "maxSteps",
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString()
        });
        return { status: "limit_reached", steps, changeSet, plan: planManager.getPlan() };
      }

      if (Date.now() - startTime > ctx.limits.maxExecutionTimeMs) {
        this.changeState(ctx, "LIMIT_REACHED", "Max execution time reached");
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
            startTime,
            steps,
            toolCtx,
            lastAssistantText
          );
        }
      }

      // If the current step is a VALIDATE step, trigger VerificationEngine directly
      if (currentStep && currentStep.type === "VALIDATE") {
        this.changeState(ctx, "VERIFYING", "Executing verification checks");
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
          userPrompt: ctx.userPrompt,
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

        if (lastVerification.status === "PASSED") {
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
              startTime,
              steps,
              toolCtx,
              lastAssistantText
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
            this.changeState(ctx, "DIAGNOSING", `Diagnosing failure in ${failedCheck.name}`);
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
            const repairDecision = this.repairEngine.evaluateRepair({
              taskId: ctx.taskId,
              diagnosis: lastDiagnosis,
              proposedTargetFiles: lastDiagnosis.affectedFiles,
              existingChangedFiles: Array.from(changeSet.changes.keys()),
              startTimeMs: startTime,
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

              this.changeState(ctx, "REPAIRING", `Repairing failure in ${repairDecision.targetFiles.join(", ")}`);
              
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
                this.changeState(ctx, "LIMIT_REACHED", reason);
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
                this.changeState(ctx, "FAILED", reason);
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
            const errSummary = lastVerification.summary;
            this.changeState(ctx, "FAILED", errSummary);
            ctx.onEvent({
              type: "task.failed",
              error: errSummary,
              eventId: `evt-${Date.now()}`,
              taskId: ctx.taskId,
              timestamp: new Date().toISOString()
            });
            return {
              status: "failed",
              error: errSummary,
              steps,
              changeSet,
              plan: planManager.getPlan(),
              verificationResult: lastVerification
            };
          }
        }
      }

      // Step execution via Model
      this.changeState(ctx, "THINKING", "Thinking...");
      steps++;

      let response;
      try {
        response = await this.model.generate({
          prompt: ctx.userPrompt,
          systemPrompt: ctx.systemPrompt,
          messages,
          tools
        });
      } catch (err: any) {
        this.changeState(ctx, "FAILED", `Provider Error: ${err.message}`);
        ctx.onEvent({
          type: "task.failed",
          error: err.message,
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString()
        });
        return { status: "failed", error: err.message, steps, changeSet, plan: planManager.getPlan() };
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
          planManager.completeStep(currentStep.id, response.text?.slice(0, 100));
          ctx.onEvent({
            type: "plan.step.completed",
            eventId: `evt-${Date.now()}`,
            taskId: ctx.taskId,
            timestamp: new Date().toISOString(),
            planId: planManager.getPlan().planId,
            planVersion: planManager.getPlan().version,
            stepId: currentStep.id,
            resultSummary: response.text?.slice(0, 100)
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
          startTime,
          steps,
          toolCtx,
          lastAssistantText
        );
      }

      // Execute tool calls
      this.changeState(ctx, "TOOL_CALLING", "Executing tools...");

      for (const tc of response.toolCalls) {
        toolCallsCount++;
        if (toolCallsCount > ctx.limits.maxToolCalls) {
          this.changeState(ctx, "LIMIT_REACHED", `Max tool calls (${ctx.limits.maxToolCalls}) reached`);
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
          eventId: `evt-${Date.now()}`,
          taskId: ctx.taskId,
          timestamp: new Date().toISOString()
        });

        let toolResultStr = "";
        let result: any;
        try {
          if (tc.name === "delegate_subtask") {
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

            let toolError: any = null;
            try {
              result = await this.executor.execute(tc.name, tc.arguments, toolCtx);
            } catch (e) {
              toolError = e;
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
                    this.changeState(ctx, "FAILED", "Mutation failed and workspace state cannot be verified.");
                    ctx.onEvent({
                      type: "task.failed",
                      error: "Workspace state unknown",
                      payload: { code: "WORKSPACE_STATE_UNKNOWN", message: "Failed to verify state after tool error" },
                      eventId: `evt-${Date.now()}`,
                      taskId: ctx.taskId,
                      timestamp: new Date().toISOString()
                    });
                    return { status: "failed", error: "WORKSPACE_STATE_UNKNOWN", steps, changeSet, plan: planManager.getPlan() };
                  } else {
                    this.changeState(ctx, "FAILED", "Integrity Error: Workspace mutated despite tool failure");
                    ctx.onEvent({
                      type: "task.failed",
                      error: "Workspace state changed after failure",
                      payload: { code: "WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE", message: toolError.message },
                      eventId: `evt-${Date.now()}`,
                      taskId: ctx.taskId,
                      timestamp: new Date().toISOString()
                    });
                    return { status: "failed", error: "WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE", steps, changeSet, plan: planManager.getPlan() };
                  }
                }
                throw toolError;
              } else {
                const operation = tc.name === "create_file" && !baselineExists ? "CREATE" : "MODIFY";
                this.diffEngine.recordChange(
                  changeSet,
                  targetPath,
                  operation,
                  finalContent || tc.arguments.content || "edited",
                  baselineContent,
                  baselineHash,
                  finalHash
                );
                ctx.onEvent({
                  type: "change.created",
                  path: targetPath,
                  operation,
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
            result,
            eventId: `evt-${Date.now()}`,
            taskId: ctx.taskId,
            timestamp: new Date().toISOString()
          });
        } catch (e: any) {
          toolResultStr = `ERROR: ${e.message}`;
          ctx.onEvent({
            type: "tool.completed",
            tool: tc.name,
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

      this.changeState(ctx, "OBSERVING", "Observing results");
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
    finalText?: string
  ): Promise<AgentResult> {
    this.changeState(ctx, "VERIFYING", "Evaluating completion gate and workspace integrity");

    // Run final verification if not already passed
    if (!lastVerification || lastVerification.status !== "PASSED") {
      const changedFiles = Array.from(changeSet.changes.keys());
      lastVerification = await this.verificationEngine.runVerification({
        taskId: ctx.taskId,
        workspaceRoot: ctx.workspaceRoot,
        changedFiles,
        changeSet,
        userPrompt: ctx.userPrompt,
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
    const requiredVerificationPassed = lastVerification.status === "PASSED";
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
      // Git Governance Flow
      let gitCommitResult: any;
      let gitPushResult: any;

      if (changeSet && changeSet.changes.size > 0) {
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

          if (changeSet.changes.size > 0) {
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

      this.changeState(ctx, "COMPLETED", "Task verified and completed successfully");
      ctx.onEvent({
        type: "task.completed",
        eventId: `evt-${Date.now()}`,
        taskId: ctx.taskId,
        timestamp: new Date().toISOString()
      });
      return {
        status: "completed",
        finalText,
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
      if (!requiredVerificationPassed) {
        gateFailureReason = `Required verification checks did not pass (status: ${lastVerification.status}): ${lastVerification.summary}`;
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

      this.changeState(ctx, "FAILED", gateFailureReason);
      ctx.onEvent({
        type: "task.failed",
        error: gateFailureReason,
        eventId: `evt-${Date.now()}`,
        taskId: ctx.taskId,
        timestamp: new Date().toISOString()
      });
      return {
        status: "failed",
        error: gateFailureReason,
        steps,
        changeSet,
        plan: planManager.getPlan(),
        verificationResult: lastVerification,
        workspaceIntegrity
      };
    }
  }
}

