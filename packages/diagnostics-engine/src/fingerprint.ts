import { createHash } from "crypto";

export class FingerprintGenerator {
  public static createFailureFingerprint(
    failureType: string,
    affectedFiles: string[],
    errorSignature: string
  ): string {
    const normalizedFiles = [...affectedFiles].map(f => f.trim().replace(/\\/g, "/")).sort().join(";");
    const normalizedSig = errorSignature.trim().replace(/\s+/g, " ").toLowerCase();
    const raw = `FAIL:${failureType}|FILES:${normalizedFiles}|SIG:${normalizedSig}`;
    return createHash("sha256").update(raw).digest("hex").substring(0, 16);
  }

  public static createRepairStrategyFingerprint(
    strategyType: string,
    targetFiles: string[],
    strategyDescription: string
  ): string {
    const normalizedFiles = [...targetFiles].map(f => f.trim().replace(/\\/g, "/")).sort().join(";");
    const normalizedDesc = strategyDescription.trim().replace(/\s+/g, " ").toLowerCase();
    const raw = `STRAT:${strategyType}|FILES:${normalizedFiles}|DESC:${normalizedDesc}`;
    return createHash("sha256").update(raw).digest("hex").substring(0, 16);
  }

  public static createRepairAttemptFingerprint(
    failureFingerprint: string,
    repairStrategyFingerprint: string,
    targetFiles: string[],
    proposedDiff?: string
  ): string {
    const normalizedFiles = [...targetFiles].map(f => f.trim().replace(/\\/g, "/")).sort().join(";");
    const normalizedDiff = (proposedDiff || "").trim().replace(/\s+/g, " ");
    const raw = `ATTEMPT:FF:${failureFingerprint}|SF:${repairStrategyFingerprint}|FILES:${normalizedFiles}|DIFF:${normalizedDiff}`;
    return createHash("sha256").update(raw).digest("hex").substring(0, 16);
  }
}
