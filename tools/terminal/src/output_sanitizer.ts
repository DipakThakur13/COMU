import { CommandResult } from './command_plan';

export class OutputSanitizer {
  // A simplistic redaction for basic secrets in output
  private static readonly REDACTION_REGEX = /(?:api_key|token|secret|password)["\s:=]+([a-zA-Z0-9_\-\.]{16,})/gi;

  public static sanitizeResult(result: CommandResult): CommandResult {
    return {
      ...result,
      stdout: this.redact(result.stdout),
      stderr: this.redact(result.stderr)
    };
  }

  private static redact(text: string): string {
    if (!text) return text;
    // Replace the capture group with [REDACTED]
    return text.replace(OutputSanitizer.REDACTION_REGEX, (match, secret) => {
      return match.replace(secret, '[REDACTED]');
    });
  }
}
