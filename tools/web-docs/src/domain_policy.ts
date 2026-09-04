export class DomainPolicy {
  public static readonly ALLOWED_DOMAINS: readonly string[] = [
    "developer.mozilla.org",
    "docs.github.com",
    "docs.npmjs.com",
    "pypi.org",
    "typescriptlang.org",
    "go.dev",
    "doc.rust-lang.org"
  ];

  public static isHostAllowed(hostname: string): boolean {
    if (!hostname) return false;
    const normalized = hostname.toLowerCase().trim();

    // Prevent IP addresses in hostname
    if (/^[0-9\.]+$/.test(normalized) || normalized.includes(":") || normalized.startsWith("[")) {
      return false;
    }

    // Exact match or proper subdomain match
    for (const allowed of this.ALLOWED_DOMAINS) {
      if (normalized === allowed || normalized.endsWith(`.${allowed}`)) {
        return true;
      }
    }

    return false;
  }

  public static isPrivateOrReservedIp(ip: string): boolean {
    const trimmed = ip.trim().toLowerCase();

    // IPv4 checks
    if (trimmed === "127.0.0.1" || trimmed.startsWith("127.")) {
      return true; // Loopback
    }
    if (trimmed.startsWith("10.")) {
      return true; // 10.0.0.0/8
    }
    if (trimmed.startsWith("192.168.")) {
      return true; // 192.168.0.0/16
    }
    if (trimmed.startsWith("169.254.")) {
      return true; // Link-local & cloud metadata
    }
    if (trimmed.startsWith("0.") || trimmed === "0.0.0.0") {
      return true;
    }

    // 172.16.0.0 - 172.31.255.255
    const match172 = trimmed.match(/^172\.(\d+)\./);
    if (match172) {
      const secondOctet = parseInt(match172[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) {
        return true;
      }
    }

    // IPv6 checks
    if (
      trimmed === "::1" ||
      trimmed === "::" ||
      trimmed.startsWith("fc") ||
      trimmed.startsWith("fd") ||
      trimmed.startsWith("fe80")
    ) {
      return true;
    }

    return false;
  }

  public static validateUrl(rawUrl: string): { valid: boolean; error?: string; url?: URL } {
    if (!rawUrl || typeof rawUrl !== "string") {
      return { valid: false, error: "Empty or invalid URL provided." };
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { valid: false, error: "Malformed URL." };
    }

    // Scheme must be HTTPS
    if (parsed.protocol !== "https:") {
      return { valid: false, error: `FORBIDDEN_SCHEME: Scheme '${parsed.protocol}' is not allowed. Only HTTPS is permitted.` };
    }

    // Reject credentials
    if (parsed.username || parsed.password) {
      return { valid: false, error: "FORBIDDEN_CREDENTIALS: URL credentials are not permitted." };
    }

    const host = parsed.hostname;

    // Check private/loopback IP
    if (this.isPrivateOrReservedIp(host)) {
      return { valid: false, error: `SSRF_BLOCKED: Access to private or loopback IP '${host}' is blocked.` };
    }

    // Check allowlist
    if (!this.isHostAllowed(host)) {
      return {
        valid: false,
        error: `DOMAIN_BLOCKED: Host '${host}' is not in the approved documentation domain allowlist.`
      };
    }

    return { valid: true, url: parsed };
  }
}
