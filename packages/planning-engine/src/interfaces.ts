import { TaskPlan, PlanStep, PlanStepType, PlanStepStatus } from "@comu/protocol";

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
}

export interface PlanValidatorOptions {
  maxSteps?: number;
  minSteps?: number;
  allowEmptyDependencies?: boolean;
}

export interface TaskPlannerOptions {
  maxSteps?: number;
  enableDynamicMutation?: boolean;
}

export interface TaskAnalysis {
  complexity: "SIMPLE" | "MEDIUM" | "COMPLEX";
  intent: "FIX_BUG" | "REFACTOR" | "ADD_FEATURE" | "EXPLORE" | "DOCS" | "GENERAL";
  summary: string;
  recommendedSteps: PlanStepType[];
}
