# COMU Sandboxed Web Documentation Access

## 1. Overview

Milestone 7 introduces `tools/web-docs` (`@comu/tool-web-docs`), providing COMU and its Research Worker agents with secure, read-only access to official engineering documentation.

This is NOT a generic web browser agent, HTTP client, or arbitrary network scraper. It is a strictly sandboxed, bounded documentation extractor.

---

## 2. Security Architecture & SSRF Defenses

### 1. Strict Domain Allowlist
Requests are restricted to an explicit canonical list of documentation sources:
- `developer.mozilla.org`
- `docs.github.com`
- `docs.npmjs.com`
- `pypi.org`
- `typescriptlang.org`
- `go.dev`
- `doc.rust-lang.org`

Exact host match or authorized subdomain match is required (`DomainPolicy.isHostAllowed`). Substring matching (e.g. `evil-developer.mozilla.org`) is strictly rejected.

### 2. Protocol & Scheme Restrictions
- Only `https:` URLs are permitted.
- `http:`, `file:`, `ftp:`, and custom schemes are rejected with `FORBIDDEN_SCHEME`.

### 3. IP & SSRF Blocking
Both target URLs and redirect destinations are validated against `DomainPolicy.isPrivateOrReservedIp`:
- Loopback addresses (`127.0.0.1`, `::1`, `localhost`)
- Private IPv4 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- Link-local and cloud metadata endpoints (`169.254.169.254`, `fe80::/10`)
- Multicast and broadcast addresses

### 4. Redirect Governance
- Redirects are limited to a maximum of 3 hops.
- Every intermediate hop and final redirect URL is re-evaluated against the domain allowlist and SSRF filters before fetching content.

---

## 3. Resource Bounds & Extraction Sandbox

1. **Size Limits:**
   - Response size is capped at 2MB (`maxBytes`).
   - Content extraction limits prevent memory exhaustion.
2. **Zero JavaScript Execution:**
   - Fetched documents are parsed purely as static text/HTML.
   - No browser engine or V8 script execution is invoked.
   - All `<script>`, `<style>`, `<iframe]`, `<form>`, and object tags are stripped.
3. **Structured Evidence:**
   - Responses return clean structured markdown/text alongside canonical URL provenance, content length, and retrieval timestamp.
