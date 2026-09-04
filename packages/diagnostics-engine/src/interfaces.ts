import { FailureType, FailureEvidence, FailureDiagnosis, VerificationCheck } from "@comu/protocol";

export interface DiagnosticExtractionResult {
  failureType: FailureType;
  primaryErrorSignature: string;
  affectedFiles: string[];
  evidence: FailureEvidence;
  confidence: number;
}

export interface DiagnosticianOptions {
  workspaceRoot?: string;
}
