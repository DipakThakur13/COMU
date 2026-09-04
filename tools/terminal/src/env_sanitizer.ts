export class EnvSanitizer {
  private static readonly SENSITIVE_PATTERNS = [
    /_TOKEN$/i,
    /_SECRET$/i,
    /_PASSWORD$/i,
    /_API_KEY$/i,
    /_PRIVATE_KEY$/i,
    /^NVIDIA_API_KEY$/i,
    /^OPENAI_API_KEY$/i,
    /^ANTHROPIC_API_KEY$/i,
    /^GOOGLE_API_KEY$/i,
    /^AWS_ACCESS_KEY_ID$/i,
    /^AWS_SECRET_ACCESS_KEY$/i,
    /^GITHUB_TOKEN$/i,
    /^GH_TOKEN$/i,
    /^GITLAB_TOKEN$/i,
    /^NPM_TOKEN$/i
  ];

  public static sanitize(env: Record<string, string | undefined>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined && !this.isSensitive(key)) {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  public static isSensitive(key: string): boolean {
    return EnvSanitizer.SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
  }
}
