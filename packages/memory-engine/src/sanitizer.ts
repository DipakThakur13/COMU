import { SanitizationResult } from "./interfaces.js";

export class MemorySanitizer {
  private static readonly SECRET_PATTERNS: { name: string; pattern: RegExp; replacement: string }[] = [
    {
      name: "PRIVATE_KEY",
      pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
      replacement: "[REDACTED_PRIVATE_KEY]"
    },
    {
      name: "BEARER_TOKEN",
      pattern: /Bearer\s+[a-zA-Z0-9_\-\.]{16,}/gi,
      replacement: "Bearer [REDACTED_TOKEN]"
    },
    {
      name: "OPENAI_KEY",
      pattern: /sk-[a-zA-Z0-9_-]{20,}/g,
      replacement: "[REDACTED_API_KEY]"
    },
    {
      name: "NVIDIA_KEY",
      pattern: /nvapi-[a-zA-Z0-9_-]{20,}/g,
      replacement: "[REDACTED_NVIDIA_KEY]"
    },
    {
      name: "GITHUB_TOKEN",
      pattern: /gh[pousr]_[a-zA-Z0-9]{20,}/g,
      replacement: "[REDACTED_GITHUB_TOKEN]"
    },
    {
      name: "AWS_ACCESS_KEY",
      pattern: /AKIA[0-9A-Z]{16}/g,
      replacement: "[REDACTED_AWS_KEY]"
    },
    {
      name: "GENERIC_API_KEY",
      pattern: /(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key)\s*[:=]\s*["']?([a-zA-Z0-9_\-\.]{12,})["']?/gi,
      replacement: "api_key=[REDACTED]"
    },
    {
      name: "GENERIC_PASSWORD",
      pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?([^\s"']{6,})["']?/gi,
      replacement: "password=[REDACTED]"
    },
    {
      name: "ENV_SECRET",
      pattern: /^[A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*=.*$/gim,
      replacement: "[REDACTED_ENV_SECRET]"
    }
  ];

  public static sanitize(text: string): SanitizationResult {
    if (!text || typeof text !== "string") {
      return { content: text || "", sanitized: false, redactedPatterns: [] };
    }

    let sanitizedContent = text;
    const redactedPatterns: string[] = [];

    for (const rule of this.SECRET_PATTERNS) {
      if (rule.pattern.test(sanitizedContent)) {
        sanitizedContent = sanitizedContent.replace(rule.pattern, rule.replacement);
        redactedPatterns.push(rule.name);
      }
    }

    return {
      content: sanitizedContent,
      sanitized: redactedPatterns.length > 0,
      redactedPatterns
    };
  }
}
