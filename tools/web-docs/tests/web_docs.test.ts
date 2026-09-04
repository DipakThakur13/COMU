import { describe, it, expect } from "vitest";
import { DomainPolicy } from "../src/domain_policy.js";
import { WebDocsTool } from "../src/doc_reader_tool.js";

describe("Web Documentation Access & SSRF Defenses", () => {
  it("should allow approved documentation domains and subdomains", () => {
    expect(DomainPolicy.isHostAllowed("developer.mozilla.org")).toBe(true);
    expect(DomainPolicy.isHostAllowed("docs.github.com")).toBe(true);
    expect(DomainPolicy.isHostAllowed("typescriptlang.org")).toBe(true);
    expect(DomainPolicy.isHostAllowed("sub.typescriptlang.org")).toBe(true);
  });

  it("should reject disallowed domains and substring attack attempts", () => {
    expect(DomainPolicy.isHostAllowed("google.com")).toBe(false);
    expect(DomainPolicy.isHostAllowed("eviltypescriptlang.org")).toBe(false);
    expect(DomainPolicy.isHostAllowed("developer.mozilla.org.attacker.com")).toBe(false);
  });

  it("should block non-HTTPS schemes", () => {
    const resHttp = DomainPolicy.validateUrl("http://developer.mozilla.org/en-US/docs");
    expect(resHttp.valid).toBe(false);
    expect(resHttp.error).toContain("FORBIDDEN_SCHEME");

    const resFtp = DomainPolicy.validateUrl("ftp://developer.mozilla.org/file");
    expect(resFtp.valid).toBe(false);
  });

  it("should block loopback, link-local, and private IP addresses (SSRF)", () => {
    expect(DomainPolicy.isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(DomainPolicy.isPrivateOrReservedIp("10.0.0.5")).toBe(true);
    expect(DomainPolicy.isPrivateOrReservedIp("192.168.1.1")).toBe(true);
    expect(DomainPolicy.isPrivateOrReservedIp("172.16.0.1")).toBe(true);
    expect(DomainPolicy.isPrivateOrReservedIp("169.254.169.254")).toBe(true); // AWS/Cloud metadata
    expect(DomainPolicy.isPrivateOrReservedIp("::1")).toBe(true);
  });

  it("should reject credentials embedded in URL", () => {
    const res = DomainPolicy.validateUrl("https://admin:secret@developer.mozilla.org/");
    expect(res.valid).toBe(false);
    expect(res.error).toContain("FORBIDDEN_CREDENTIALS");
  });

  it("should strip unsafe tags and clean HTML into structured markdown", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Array.prototype.map() - MDN</title>
          <script>alert("malicious");</script>
          <style>body { color: red; }</style>
        </head>
        <body>
          <h1>map() method</h1>
          <p>The <b>map()</b> method creates a new array populated with the results.</p>
          <pre><code>const doubled = [1, 2, 3].map(x => x * 2);</code></pre>
          <ul>
            <li>item 1</li>
            <li>item 2</li>
          </ul>
        </body>
      </html>
    `;

    const extracted = WebDocsTool.htmlToMarkdown(html);
    expect(extracted.title).toBe("Array.prototype.map() - MDN");
    expect(extracted.text).not.toContain("alert");
    expect(extracted.text).not.toContain("color: red");
    expect(extracted.text).toContain("# map() method");
    expect(extracted.text).toContain("```");
    expect(extracted.text).toContain("const doubled = [1, 2, 3].map(x => x * 2);");
    expect(extracted.text).toContain("- item 1");
  });
});
