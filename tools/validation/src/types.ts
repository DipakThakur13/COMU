export type ValidationStatus = "PASS" | "FAIL" | "TIMEOUT" | "CANCELLED" | "UNAVAILABLE";

export interface ValidationResult {
  validatorId: string;
  name: string;

  status: ValidationStatus;
  exitCode: number | null;

  stdout: string;
  stderr: string;

  durationMs: number;
  outputTruncated: boolean;
}

export type ProjectType = "Node" | "TypeScript" | "Python" | "Go" | "Rust" | "Java" | "Unknown";

export interface ValidationContext {
  cwd: string;
  target: "test" | "build" | "lint" | "typecheck";
}
