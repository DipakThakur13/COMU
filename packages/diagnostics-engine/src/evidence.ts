import { FailureEvidence, FailureEvidenceItem } from "@comu/protocol";

export class EvidenceExtractor {
  public static extractEvidence(stdout: string, stderr: string, exitCode?: number): FailureEvidence {
    const combined = `${stdout}\n${stderr}`;
    const items: FailureEvidenceItem[] = [];
    const failingTests: string[] = [];

    // 1. Extract TypeScript compiler errors (e.g., src/foo.ts(42,15): error TS2345: Argument of type...)
    const tsRegex = /([a-zA-Z0-9_\-./\\]+\.(?:ts|tsx|js|jsx))(?:\((\d+),(\d+)\))?:\s*error\s*(TS\d+):\s*(.+)/g;
    let tsMatch;
    while ((tsMatch = tsRegex.exec(combined)) !== null) {
      items.push({
        type: "COMPILER_ERROR",
        file: tsMatch[1].replace(/\\/g, "/"),
        line: tsMatch[2] ? parseInt(tsMatch[2], 10) : undefined,
        column: tsMatch[3] ? parseInt(tsMatch[3], 10) : undefined,
        code: tsMatch[4],
        message: tsMatch[5].trim(),
        raw: tsMatch[0]
      });
    }

    // 2. Extract failing test suites (Jest / Vitest / Mocha patterns)
    const testFailRegex = /(?:FAIL|✕|failed|FAILED)\s+([a-zA-Z0-9_\-./\\]+\.(?:test|spec)\.(?:ts|tsx|js|jsx))/g;
    let testMatch;
    while ((testMatch = testFailRegex.exec(combined)) !== null) {
      const testFile = testMatch[1].replace(/\\/g, "/");
      if (!failingTests.includes(testFile)) {
        failingTests.push(testFile);
      }
      items.push({
        type: "TEST_FAILURE",
        file: testFile,
        message: `Failing test file: ${testFile}`,
        raw: testMatch[0]
      });
    }

    // 3. Extract AssertionErrors / Stack traces
    const assertionRegex = /AssertionError(?::\s*([^\n]+))?/g;
    let assertMatch;
    while ((assertMatch = assertionRegex.exec(combined)) !== null) {
      items.push({
        type: "ASSERTION_ERROR",
        message: assertMatch[1] ? assertMatch[1].trim() : "Assertion error",
        raw: assertMatch[0]
      });
    }

    // 4. Extract stack trace frames
    const stackRegex = /at\s+(?:([a-zA-Z0-9_$.<>]+)\s+\()?([a-zA-Z0-9_\-./\\]+\.(?:ts|tsx|js|jsx)):(\d+):(\d+)\)?/g;
    let stackMatch;
    while ((stackMatch = stackRegex.exec(combined)) !== null) {
      const filePath = stackMatch[2].replace(/\\/g, "/");
      if (!filePath.includes("node_modules")) {
        items.push({
          type: "STACK_FRAME",
          file: filePath,
          line: parseInt(stackMatch[3], 10),
          column: parseInt(stackMatch[4], 10),
          message: stackMatch[1] ? `in function ${stackMatch[1]}` : `at ${filePath}:${stackMatch[3]}`,
          raw: stackMatch[0]
        });
      }
    }

    return {
      exitCode,
      stdout: stdout.slice(0, 4000),
      stderr: stderr.slice(0, 4000),
      failingTests,
      items
    };
  }
}
