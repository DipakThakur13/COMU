"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutputSanitizer = void 0;
class OutputSanitizer {
    // A simplistic redaction for basic secrets in output
    static REDACTION_REGEX = /(?:api_key|token|secret|password)["\s:=]+([a-zA-Z0-9_\-\.]{16,})/gi;
    static sanitizeResult(result) {
        return {
            ...result,
            stdout: this.redact(result.stdout),
            stderr: this.redact(result.stderr)
        };
    }
    static redact(text) {
        if (!text)
            return text;
        // Replace the capture group with [REDACTED]
        return text.replace(OutputSanitizer.REDACTION_REGEX, (match, secret) => {
            return match.replace(secret, '[REDACTED]');
        });
    }
}
exports.OutputSanitizer = OutputSanitizer;
//# sourceMappingURL=output_sanitizer.js.map