import { TaskPlan, PlanStep, PlanStepType, PlanStepStatus } from "@comu/protocol";
import { PlanValidationResult, PlanValidatorOptions } from "./interfaces.js";

const VALID_STEP_TYPES: Set<PlanStepType> = new Set([
  "INVESTIGATE",
  "IMPLEMENT",
  "VALIDATE",
  "DIAGNOSE",
  "REPAIR",
  "USER_INPUT"
]);

const VALID_STEP_STATUSES: Set<PlanStepStatus> = new Set([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "SKIPPED"
]);

export class PlanValidator {
  private maxSteps: number;
  private minSteps: number;

  constructor(options?: PlanValidatorOptions) {
    this.maxSteps = options?.maxSteps ?? 20;
    this.minSteps = options?.minSteps ?? 1;
  }

  public validate(plan: TaskPlan): PlanValidationResult {
    const errors: string[] = [];

    if (!plan.planId || typeof plan.planId !== "string" || plan.planId.trim() === "") {
      errors.push("Plan must have a non-empty planId.");
    }

    if (!plan.taskId || typeof plan.taskId !== "string" || plan.taskId.trim() === "") {
      errors.push("Plan must have a non-empty taskId.");
    }

    if (!Array.isArray(plan.steps)) {
      errors.push("Plan must contain a steps array.");
      return { valid: false, errors };
    }

    if (plan.steps.length < this.minSteps) {
      errors.push(`Plan must have at least ${this.minSteps} step(s), got ${plan.steps.length}.`);
    }

    if (plan.steps.length > this.maxSteps) {
      errors.push(`Plan exceeds maximum allowable steps (${this.maxSteps}), got ${plan.steps.length}.`);
    }

    const seenIds = new Set<string>();
    const seenTitles = new Set<string>();

    for (const step of plan.steps) {
      if (!step.id || typeof step.id !== "string" || step.id.trim() === "") {
        errors.push("Every plan step must have a non-empty id.");
        continue;
      }

      if (seenIds.has(step.id)) {
        errors.push(`Duplicate step id detected: '${step.id}'.`);
      }
      seenIds.add(step.id);

      if (!VALID_STEP_TYPES.has(step.type)) {
        errors.push(`Invalid step type '${step.type}' for step '${step.id}'.`);
      }

      if (!VALID_STEP_STATUSES.has(step.status)) {
        errors.push(`Invalid step status '${step.status}' for step '${step.id}'.`);
      }

      if (!step.title || typeof step.title !== "string" || step.title.trim() === "") {
        errors.push(`Step '${step.id}' must have a non-empty title.`);
      } else {
        const normalizedTitle = step.title.trim().toLowerCase();
        if (seenTitles.has(normalizedTitle)) {
          // Warning or error on duplicate identical titles
          errors.push(`Duplicate semantic step title detected: '${step.title}'.`);
        }
        seenTitles.add(normalizedTitle);
      }
    }

    // Validate dependencies exist
    for (const step of plan.steps) {
      if (Array.isArray(step.dependencies)) {
        for (const depId of step.dependencies) {
          if (!seenIds.has(depId)) {
            errors.push(`Step '${step.id}' references non-existent dependency id '${depId}'.`);
          }
          if (depId === step.id) {
            errors.push(`Step '${step.id}' cannot depend on itself.`);
          }
        }
      }
    }

    // Cycle detection using Kahn's topological sort
    if (errors.length === 0 && plan.steps.length > 0) {
      const inDegree = new Map<string, number>();
      const adjList = new Map<string, string[]>();

      for (const step of plan.steps) {
        inDegree.set(step.id, step.dependencies?.length || 0);
        adjList.set(step.id, []);
      }

      for (const step of plan.steps) {
        if (step.dependencies) {
          for (const depId of step.dependencies) {
            adjList.get(depId)?.push(step.id);
          }
        }
      }

      const queue: string[] = [];
      for (const [id, deg] of inDegree.entries()) {
        if (deg === 0) {
          queue.push(id);
        }
      }

      let visitedCount = 0;
      while (queue.length > 0) {
        const current = queue.shift()!;
        visitedCount++;

        const neighbors = adjList.get(current) || [];
        for (const neighbor of neighbors) {
          const newDeg = (inDegree.get(neighbor) || 1) - 1;
          inDegree.set(neighbor, newDeg);
          if (newDeg === 0) {
            queue.push(neighbor);
          }
        }
      }

      if (visitedCount < plan.steps.length) {
        errors.push("Circular dependency detected in plan steps.");
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
