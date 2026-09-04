import { AgentTool, ToolCapability, ToolContext } from "@comu/tool-core";
import { WebDocResult } from "@comu/protocol";
import { DomainPolicy } from "./domain_policy.js";

export class WebDocsTool implements AgentTool<any, WebDocResult> {
  name = "web_docs";
  description = "Fetch official documentation content safely from allowed documentation domains.";
  capabilities: ToolCapability[] = ["execute"];
  inputSchema = {
    type: "object",
    properties: {
      url: { type: "string", description: "HTTPS URL of the documentation page" },
      maxBytes: { type: "number", description: "Maximum bytes to extract (default 50000)" }
    },
    required: ["url"]
  };

  public static htmlToMarkdown(html: string): { title: string; text: string } {
    let title = "";
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].trim().replace(/\s+/g, " ");
    }

    // Strip scripts, styles, noscript, svg, iframes
    let cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "")
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");

    // Convert code blocks
    cleaned = cleaned.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
      const decoded = code
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"');
      return `\n\`\`\`\n${decoded.trim()}\n\`\`\`\n`;
    });

    // Convert headings
    cleaned = cleaned.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
    cleaned = cleaned.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
    cleaned = cleaned.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");

    // Convert paragraphs & list items
    cleaned = cleaned.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1");
    cleaned = cleaned.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
    cleaned = cleaned.replace(/<br\s*\/?>/gi, "\n");

    // Strip all remaining tags
    cleaned = cleaned.replace(/<[^>]+>/g, "");

    // Decode remaining HTML entities
    cleaned = cleaned
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");

    // Compress whitespace
    const lines = cleaned
      .split("\n")
      .map(l => l.trim())
      .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0));

    return {
      title,
      text: lines.join("\n")
    };
  }

  async execute(args: { url: string; maxBytes?: number }, context?: ToolContext): Promise<WebDocResult> {
    const rawUrl = args.url;
    const maxBytes = Math.min(100000, Math.max(1000, args.maxBytes || 50000));

    // 1. Initial URL validation
    let currentUrl = rawUrl;
    let validated = DomainPolicy.validateUrl(currentUrl);
    if (!validated.valid || !validated.url) {
      return {
        url: rawUrl,
        canonicalUrl: rawUrl,
        sourceDomain: "",
        title: "",
        content: "",
        evidence: {
          canonicalUrl: rawUrl,
          sourceDomain: "",
          contentType: "unknown",
          retrievedAt: new Date().toISOString(),
          contentLength: 0
        },
        error: validated.error || "URL validation failed."
      };
    }

    // 2. Fetch with manual redirect handling and destination verification
    let redirectCount = 0;
    const maxRedirects = 3;
    let response: Response | null = null;
    let finalUrl = validated.url;

    while (redirectCount <= maxRedirects) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        response = await fetch(finalUrl.toString(), {
          method: "GET",
          headers: {
            "User-Agent": "COMU-Agent/1.0 (Developer Documentation Reader)",
            Accept: "text/html, text/plain, text/markdown"
          },
          redirect: "manual",
          signal: controller.signal
        });
      } catch (err: any) {
        clearTimeout(timeout);
        return {
          url: rawUrl,
          canonicalUrl: finalUrl.toString(),
          sourceDomain: finalUrl.hostname,
          title: "",
          content: "",
          evidence: {
            canonicalUrl: finalUrl.toString(),
            sourceDomain: finalUrl.hostname,
            contentType: "unknown",
            retrievedAt: new Date().toISOString(),
            contentLength: 0
          },
          error: `Fetch error: ${err.message}`
        };
      } finally {
        clearTimeout(timeout);
      }

      // Handle Redirect
      if ([301, 302, 307, 308].includes(response.status)) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          return {
            url: rawUrl,
            canonicalUrl: finalUrl.toString(),
            sourceDomain: finalUrl.hostname,
            title: "",
            content: "",
            evidence: {
              canonicalUrl: finalUrl.toString(),
              sourceDomain: finalUrl.hostname,
              contentType: "unknown",
              retrievedAt: new Date().toISOString(),
              contentLength: 0
            },
            error: "EXCESSIVE_REDIRECTS: Exceeded maximum redirect limit (3)."
          };
        }

        const location = response.headers.get("location");
        if (!location) {
          return {
            url: rawUrl,
            canonicalUrl: finalUrl.toString(),
            sourceDomain: finalUrl.hostname,
            title: "",
            content: "",
            evidence: {
              canonicalUrl: finalUrl.toString(),
              sourceDomain: finalUrl.hostname,
              contentType: "unknown",
              retrievedAt: new Date().toISOString(),
              contentLength: 0
            },
            error: "Redirect missing location header."
          };
        }

        const nextUrl = new URL(location, finalUrl);
        const nextValidation = DomainPolicy.validateUrl(nextUrl.toString());
        if (!nextValidation.valid || !nextValidation.url) {
          return {
            url: rawUrl,
            canonicalUrl: nextUrl.toString(),
            sourceDomain: nextUrl.hostname,
            title: "",
            content: "",
            evidence: {
              canonicalUrl: nextUrl.toString(),
              sourceDomain: nextUrl.hostname,
              contentType: "unknown",
              retrievedAt: new Date().toISOString(),
              contentLength: 0
            },
            error: `REDIRECT_BLOCKED: ${nextValidation.error}`
          };
        }

        finalUrl = nextValidation.url;
        continue;
      }

      break;
    }

    if (!response || !response.ok) {
      return {
        url: rawUrl,
        canonicalUrl: finalUrl.toString(),
        sourceDomain: finalUrl.hostname,
        title: "",
        content: "",
        evidence: {
          canonicalUrl: finalUrl.toString(),
          sourceDomain: finalUrl.hostname,
          contentType: "unknown",
          retrievedAt: new Date().toISOString(),
          contentLength: 0
        },
        error: `HTTP Error: ${response ? response.status : "No response"}`
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("text/markdown")) {
      return {
        url: rawUrl,
        canonicalUrl: finalUrl.toString(),
        sourceDomain: finalUrl.hostname,
        title: "",
        content: "",
        evidence: {
          canonicalUrl: finalUrl.toString(),
          sourceDomain: finalUrl.hostname,
          contentType,
          retrievedAt: new Date().toISOString(),
          contentLength: 0
        },
        error: `UNSUPPORTED_CONTENT_TYPE: Content type '${contentType}' is not supported.`
      };
    }

    const rawText = await response.text();
    const extracted = WebDocsTool.htmlToMarkdown(rawText);
    const boundedText = extracted.text.slice(0, maxBytes);

    return {
      url: rawUrl,
      canonicalUrl: finalUrl.toString(),
      sourceDomain: finalUrl.hostname,
      title: extracted.title || finalUrl.pathname,
      content: boundedText,
      evidence: {
        canonicalUrl: finalUrl.toString(),
        sourceDomain: finalUrl.hostname,
        contentType,
        retrievedAt: new Date().toISOString(),
        contentLength: boundedText.length
      }
    };
  }
}
