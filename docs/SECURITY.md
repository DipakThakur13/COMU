# COMU Security Architecture & Safety Guarantees

## 1. Absolute Security Invariants

1. **Single Execution Authority**: `AgentOrchestrator` owns the execution loop. No subagent or decision engine may execute tools directly or bypass security boundaries.
2. **Model Has No Direct Authority**: The model may propose actions, but permissions, command safety categories, and verification decisions remain runtime-authoritative.
3. **Optimistic Concurrency Control (OCC)**: All file mutations track baseline hashes and compare against on-disk state to detect external drift or race conditions.
4. **Authoritative Completion Gate**: A model cannot claim "Fixed" without passing required verification and workspace integrity checks.
5. **No Secret Leakage**: No credentials, API keys, private tokens, or hidden model chain-of-thought are exposed in SSE events, logs, or UI streams.

---

## 2. Workspace Boundary Protection

Filesystem tools (`read_file`, `write_file`, `edit_file`, `list_directory`, `get_workspace_tree`) enforce strict boundary security:
- **Canonical Path Resolution**: Paths are resolved using `path.resolve` and normalized.
- **Root Confinement**: Traversal attempts outside `workspaceRoot` (e.g. `../../etc/passwd` or `..\..\Windows`) are rejected with `PATH_OUTSIDE_WORKSPACE`.
- **Symlink Escape Detection**: Symlinks pointing outside the workspace boundary are rejected with `SYMLINK_OUTSIDE_WORKSPACE`.

---

## 3. Terminal & Command Execution Security

All terminal actions are governed by `CommandPolicy` and managed by `ProcessManager`:
- **Allowed Categories**: Only commands classified as `SAFE_DEVELOPMENT` or `OBSERVABILITY` are permitted without elevation.
- **Forbidden Categories**:
  - `FORBIDDEN_DESTRUCTIVE`: Arbitrary deletion or formatting (e.g. `rm -rf /`, `del /f /s /q`).
  - `FORBIDDEN_REMOTE_EXECUTION`: Unrestricted remote scripts (e.g. `curl | bash`).
  - `FORBIDDEN_PERSISTENCE`: System services, startup modifications.
- **Disallowed in Milestone 6**:
  - `git commit`, `git push`, `git reset --hard`, `git clean -fd`.
- **Environment Sanitization**: Sensitive environment variables (`AWS_SECRET_ACCESS_KEY`, `OPENAI_API_KEY`, etc.) are stripped from sub-process environments.
- **Output Bounds**: Process standard output and standard error are capped to prevent memory exhaustion and buffer overflows.
- **Timeout & Cleanup**: Commands enforce strict execution timeouts and propagate process tree termination upon cancellation.

---

## 4. Human Interaction Security

- **Task-Scoped**: Interactions cannot be resolved across tasks; interaction requests are strictly bound to their `taskId`.
- **One-Shot Resolution**: Exactly one developer response wins. Subsequent or concurrent submissions are rejected.
- **Fail-Safe Expiration**:
  - A timeout on an `APPROVAL` interaction is treated as **NOT GRANTED**.
  - Silent or implicit permissions are strictly forbidden.

---

## 5. ChangeSet & Workspace Integrity Verification

- When a file modification is proposed, COMU captures `baselineHash` and `originalContent`.
- If a mutation fails halfway or produces an OCC conflict, COMU detects `WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE` and aborts.
- During completion gate evaluation, `WorkspaceIntegrityVerifier` audits all modified files against recorded hashes to guarantee workspace consistency.

---

## 6. Memory Security & Anti-Poisoning Defenses

- **External Storage Isolation**: Memory records default to OS application data directories, strictly outside repository trees, preventing accidental Git pollution.
- **Anti-Poisoning Hierarchy**: Repository content cannot arbitrarily become high-trust memory (`USER_VERIFIED` is reserved for explicit human developer actions).
- **Automated Secret Scrubbing**: All candidate memory content is sanitized before persistence; tokens (`ghp_`), keys (`sk-`, `nvapi-`), and bearer credentials are automatically scrubbed with replacement tokens.
- **Freshness & Invalidation**: Stale or contradicted memories lose ranking authority and cannot override verified active workspace evidence.

---

## 7. Controlled Git Security & Push Invariants

- **Gated Execution**: Staging and committing are strictly forbidden before passing the Completion Gate.
- **ChangeSet-Restricted Staging**: Staging is strictly limited to files modified within the task's authorized `ChangeSet`. Wildcard staging (`git add .`) is permanently blocked.
- **Staged Diff Integrity**: `git diff --cached` must match the expected ChangeSet. Any extraneous or unexpected developer changes halt commit immediately.
- **Explicit Push Approval**: `git_push` strictly requires developer approval (`approved: true`). Autonomous push is impossible.
- **Permanently Forbidden Commands**: `git reset --hard` and `git clean -fd` remain permanently forbidden across all tools and shells.

---

## 8. Subagent Worker Security & Single Execution Authority

- **Strict Depth Invariant**: Workers are single-level (`maxSubagentDepth = 1`). Recursive spawning is blocked at runtime.
- **Master is the Only Writer**: Workers are strictly read-only (`RESEARCH`) or validation-only (`VERIFICATION`). Workers cannot create, edit, or delete files, and cannot execute Git commits or pushes.
- **Strict Capability Enforcement**: All worker tool calls continue through `ToolRegistry` and `ToolExecutor` under strict capability limits.
- **No Orphan Workers**: Cancellation of the parent task instantly aborts all active workers.

---

## 9. Web Documentation Sandboxing & SSRF Defenses

- **Strict Domain Allowlist**: Only explicitly whitelisted official engineering documentation domains (`developer.mozilla.org`, `docs.github.com`, `typescriptlang.org`, etc.) can be queried.
- **Scheme & Protocol**: Only `https:` URLs are permitted; plain `http:` is blocked.
- **SSRF Defenses**: IP destinations and redirects are checked to block loopback (`127.0.0.1`), private IPv4 (`10.*`, `192.168.*`, `172.*`), link-local / cloud metadata (`169.254.169.254`), and IPv6 equivalents.
- **Zero JavaScript Execution**: Fetched HTML is parsed purely as static text; scripts, iframes, styles, and active content are stripped.
- **Strict Resource Bounds**: Requests enforce timeouts, a 2MB maximum payload size, and a 3-hop redirect maximum.

