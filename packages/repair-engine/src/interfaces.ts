import { RepairLimits, RepairAttempt, FailureDiagnosis, RepairDecision } from "@comu/protocol";

export interface RepairEvaluationContext {
  taskId: string;
  diagnosis: FailureDiagnosis;
  proposedTargetFiles: string[];
  proposedStrategyDescription?: string;
  existingChangedFiles: string[];
  startTimeMs: number;
  totalValidationRuns: number;
  limits?: Partial<RepairLimits>;
}

export interface RepairEngineOptions {
  defaultLimits?: RepairLimits;
}
