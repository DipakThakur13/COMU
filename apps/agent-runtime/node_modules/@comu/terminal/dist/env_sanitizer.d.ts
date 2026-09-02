export declare class EnvSanitizer {
    private static readonly SENSITIVE_PATTERNS;
    static sanitize(env: Record<string, string | undefined>): Record<string, string>;
    static isSensitive(key: string): boolean;
}
//# sourceMappingURL=env_sanitizer.d.ts.map