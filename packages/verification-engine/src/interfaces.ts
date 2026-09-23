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

/**
 * What the task contract says about verification. The kernel sets both fields from the resolved
 * mode and autonomy; nothing about them is recovered from the prompt's wording.
 */
export interface VerificationRequirement {
  /** Whether the task is expected to change files at all. */
  expectedMutation: boolean;
  /** Whether a completion must be backed by checks. False for read-only tasks. */
  verificationRequired: boolean;
}

export interface VerificationRunContext {
  taskId: string;
  workspaceRoot: string;
  changedFiles: string[];
  changeSet?: ChangeSet;
  /** From the task contract. The prompt is deliberately not an input. */
  requirement: VerificationRequirement;
  /**
   * The same checks run before the task changed anything. A required check that passed then and
   * passes now, with no test touched, is not evidence of the change.
   */
  baseline?: VerificationResult;
  toolExecutor: ToolExecutor;
  toolContext: ToolContext;
  abortSignal?: AbortSignal;
}
