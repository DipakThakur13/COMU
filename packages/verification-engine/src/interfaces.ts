import { VerificationCheck, VerificationResult, WorkspaceIntegrityResult } from "@comu/protocol";
import { ToolExecutor, ToolContext } from "@comu/tool-core";
import { ChangeSet } from "@comu/diff-engine";

export interface VerificationPolicyRule {
  name: string;
  validatorId: string;
  required: boolean;
  applicableFilePatterns?: RegExp[];
  skipReason?: string;
}

export interface VerificationPlan {
  rules: VerificationPolicyRule[];
  reason: string;
}

export interface VerificationRunContext {
  taskId: string;
  workspaceRoot: string;
  changedFiles: string[];
  changeSet?: ChangeSet;
  userPrompt?: string;
  toolExecutor: ToolExecutor;
  toolContext: ToolContext;
  abortSignal?: AbortSignal;
}
