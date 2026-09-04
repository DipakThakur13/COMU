import { TaskPlan, PlanStep, PlanStepStatus, TaskPlanStatus } from "@comu/protocol";
import { PlanValidator } from "./plan_validator.js";

export class PlanStateManager {
  private plan: TaskPlan;
  private validator: PlanValidator;

  constructor(initialPlan: TaskPlan, validator?: PlanValidator) {
    this.validator = validator || new PlanValidator();
    const validation = this.validator.validate(initialPlan);
    if (!validation.valid) {
      throw new Error(`Cannot initialize PlanStateManager with invalid plan: ${validation.errors.join("; ")}`);
    }
    this.plan = JSON.parse(JSON.stringify(initialPlan));
  }

  public getPlan(): Readonly<TaskPlan> {
    return JSON.parse(JSON.stringify(this.plan));
  }

  public getStep(stepId: string): PlanStep | undefined {
    return this.plan.steps.find(s => s.id === stepId);
  }

  public getActiveStep(): PlanStep | undefined {
    return this.plan.steps.find(s => s.status === "RUNNING");
  }

  public getEligibleSteps(): PlanStep[] {
    const completedStepIds = new Set(
      this.plan.steps.filter(s => s.status === "COMPLETED" || s.status === "SKIPPED").map(s => s.id)
    );

    return this.plan.steps.filter(step => {
      if (step.status !== "PENDING") {
        return false;
      }
      return (step.dependencies || []).every(depId => completedStepIds.has(depId));
    });
  }

  public startStep(stepId: string): TaskPlan {
    const step = this.getStep(stepId);
    if (!step) {
      throw new Error(`Step '${stepId}' not found in plan.`);
    }
    step.status = "RUNNING";
    step.attempts = (step.attempts || 0) + 1;
    this.plan.status = "EXECUTING";
    this.plan.updatedAt = new Date().toISOString();
    return this.getPlan();
  }

  public completeStep(stepId: string, resultSummary?: string): TaskPlan {
    const step = this.getStep(stepId);
    if (!step) {
      throw new Error(`Step '${stepId}' not found in plan.`);
    }
    step.status = "COMPLETED";
    if (resultSummary) {
      step.resultSummary = resultSummary;
    }
    this.plan.updatedAt = new Date().toISOString();

    const allFinished = this.plan.steps.every(s => s.status === "COMPLETED" || s.status === "SKIPPED");
    if (allFinished) {
      this.plan.status = "COMPLETED";
    }

    return this.getPlan();
  }

  public failStep(stepId: string, error?: string): TaskPlan {
    const step = this.getStep(stepId);
    if (!step) {
      throw new Error(`Step '${stepId}' not found in plan.`);
    }
    step.status = "FAILED";
    if (error) {
      step.resultSummary = `FAILED: ${error}`;
    }
    this.plan.status = "FAILED";
    this.plan.updatedAt = new Date().toISOString();

    // Block any dependent steps
    for (const otherStep of this.plan.steps) {
      if (otherStep.status === "PENDING" && otherStep.dependencies?.includes(stepId)) {
        otherStep.status = "BLOCKED";
      }
    }

    return this.getPlan();
  }

  public blockStep(stepId: string, reason?: string): TaskPlan {
    const step = this.getStep(stepId);
    if (!step) {
      throw new Error(`Step '${stepId}' not found in plan.`);
    }
    step.status = "BLOCKED";
    if (reason) {
      step.resultSummary = `BLOCKED: ${reason}`;
    }
    this.plan.updatedAt = new Date().toISOString();
    return this.getPlan();
  }

  public skipStep(stepId: string, reason?: string): TaskPlan {
    const step = this.getStep(stepId);
    if (!step) {
      throw new Error(`Step '${stepId}' not found in plan.`);
    }
    step.status = "SKIPPED";
    if (reason) {
      step.resultSummary = `SKIPPED: ${reason}`;
    }
    this.plan.updatedAt = new Date().toISOString();
    return this.getPlan();
  }

  public setPlanStatus(status: TaskPlanStatus): TaskPlan {
    this.plan.status = status;
    this.plan.updatedAt = new Date().toISOString();
    return this.getPlan();
  }

  public injectStepsAfterFailure(
    failedStepId: string,
    newSteps: PlanStep[],
    mutationReason?: string
  ): TaskPlan {
    const failedStepIndex = this.plan.steps.findIndex(s => s.id === failedStepId);
    if (failedStepIndex === -1) {
      throw new Error(`Cannot inject steps after non-existent step '${failedStepId}'.`);
    }

    const proposedPlan: TaskPlan = {
      ...this.plan,
      version: this.plan.version + 1,
      steps: [...this.plan.steps],
      status: "READY",
      updatedAt: new Date().toISOString()
    };

    const lastNewStep = newSteps[newSteps.length - 1];

    // Any subsequent steps that depended on the failed step should now depend on the last step of the repair cycle
    for (const step of proposedPlan.steps) {
      if (step.dependencies?.includes(failedStepId)) {
        step.dependencies = step.dependencies.map(d => (d === failedStepId ? lastNewStep.id : d));
        if (step.status === "BLOCKED") {
          step.status = "PENDING";
        }
      }
    }

    // Remove any subsequent placeholder steps that are superseded by the new repair steps
    const stepsBefore = proposedPlan.steps.slice(0, failedStepIndex + 1);
    const stepsAfter = proposedPlan.steps.slice(failedStepIndex + 1).filter(step => {
      const isPlaceholder =
        (step.type === "DIAGNOSE" || step.type === "REPAIR" || step.type === "VALIDATE") &&
        (step.status === "PENDING" || step.status === "BLOCKED");
      return !isPlaceholder;
    });

    proposedPlan.steps = [...stepsBefore, ...newSteps, ...stepsAfter];

    const validation = this.validator.validate(proposedPlan);
    if (!validation.valid) {
      throw new Error(
        `Dynamic plan mutation failed validation: ${validation.errors.join("; ")} (Reason: ${mutationReason || "unspecified"})`
      );
    }

    this.plan = proposedPlan;
    return this.getPlan();
  }
}

