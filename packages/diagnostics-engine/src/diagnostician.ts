import { FailureDiagnosis, VerificationCheck, RepairAction } from "@comu/protocol";
import { EvidenceExtractor } from "./evidence.js";
import { FailureClassifier } from "./classifier.js";
import { FingerprintGenerator } from "./fingerprint.js";

export class Diagnostician {
  public static diagnose(taskId: string, failedCheck: VerificationCheck): FailureDiagnosis {
    const stdout = failedCheck.evidence?.stdout || "";
    const stderr = failedCheck.evidence?.stderr || failedCheck.details || "";
    const exitCode = failedCheck.exitCode ?? failedCheck.evidence?.exitCode ?? 1;

    const evidence = EvidenceExtractor.extractEvidence(stdout, stderr, exitCode);
    const { failureType, confidence } = FailureClassifier.classify(
      failedCheck.validatorId || "",
      evidence,
      failedCheck.details
    );

    // Extract affected files from evidence
    const affectedFilesSet = new Set<string>();
    if (evidence.failingTests) {
      for (const t of evidence.failingTests) {
        affectedFilesSet.add(t);
      }
    }
    if (evidence.items) {
      for (const item of evidence.items) {
        if (item.file) {
          affectedFilesSet.add(item.file);
        }
      }
    }

    const affectedFiles = Array.from(affectedFilesSet);

    // Extract primary error signature
    let primaryErrorSignature = failedCheck.details || "Command failed without specific message";
    if (evidence.items && evidence.items.length > 0) {
      const firstCompiler = evidence.items.find(i => i.type === "COMPILER_ERROR");
      const firstAssertion = evidence.items.find(i => i.type === "ASSERTION_ERROR");
      const firstTest = evidence.items.find(i => i.type === "TEST_FAILURE");

      if (firstCompiler) {
        primaryErrorSignature = `${firstCompiler.code || "TS"}: ${firstCompiler.message}`;
      } else if (firstAssertion) {
        primaryErrorSignature = `AssertionError: ${firstAssertion.message}`;
      } else if (firstTest) {
        primaryErrorSignature = firstTest.message;
      }
    }

    const failureFingerprint = FingerprintGenerator.createFailureFingerprint(
      failureType,
      affectedFiles,
      primaryErrorSignature
    );

    // Suggested actions based on failure type
    const suggestedActions: RepairAction[] = [];
    if (affectedFiles.length > 0) {
      suggestedActions.push({
        type: "EDIT_CODE",
        description: `Modify affected source files to resolve ${failureType}: ${primaryErrorSignature.slice(0, 80)}`,
        targetFiles: affectedFiles
      });
    }

    const diagnosisId = `diag-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const summary = `${failureType} detected in ${failedCheck.name}: ${primaryErrorSignature}`;

    return {
      diagnosisId,
      taskId,
      failureType,
      summary,
      affectedFiles,
      evidence,
      confidence,
      failureFingerprint,
      suggestedActions,
      timestamp: new Date().toISOString()
    };
  }
}
