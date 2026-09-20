# COMU Security Architecture & Safety Guarantees

## 1. Absolute Security Invariants

1. **Single Execution Authority**: `AgentOrchestrator` owns the execution loop. No subagent or decision engine may execute tools directly or bypass security boundaries.
2. **Model Has No Direct Authority**: The model may propose actions, but permissions, command safety categories, and verification decisions remain runtime-authoritative.
   - **Mode contract enforcement**: every model-originated tool call goes through `ToolExecutor.processModelToolCall`, which validates the `TaskContract` (ASK/PLAN: `read` + `network`; AGENT: `read` + `write` + `execute` + `network`) and then the executor permissions derived from it. The tool list offered to the model is filtered by the same contract, so a read-only task never sees `write_file` or `execute_command`. PLAN and CHAT are offered no tools and never enter `TOOL_CALLING`. Verification, workspace-integrity checks and git governance run under a separate runtime-authoritative context (read + execute, never write, never network) because the runtime, not the model, decides to run them. Worker subagents run with the parent's permissions intersected with their declared capabilities (RESEARCH: read + network; VERIFICATION: read + execute).
3. **Optimistic Concurrency Control (OCC)**: All file mutations track baseline hashes and compare against on-disk state to detect external drift or race conditions.
4. **Authoritative Completion Gate**: A model cannot claim "Fixed" without passing required verification and workspace integrity checks.
5. **No Secret Leakage**: No credentials, API keys, private tokens, or hidden model chain-of-thought are exposed in SSE events, logs, or UI streams.

---

## 2. Runtime Network Boundary & Authentication

The Agent Runtime (`apps/agent-runtime`) is a local daemon with authority to read and write workspace files and run commands, so it is never exposed as an open server:
- **Loopback only**: the runtime binds to `127.0.0.1` exclusively (`startRuntimeServer`). A defence-in-depth middleware additionally rejects any request whose peer address is not loopback with `403 NON_LOOPBACK_REJECTED`.
- **Per-session token**: the VS Code extension generates a random 256-bit token for each session (or honours `COMU_RUNTIME_TOKEN` if set), passes it to the spawned runtime through the environment, and sends it as `Authorization: Bearer <token>` (or `X-COMU-Token`) on every request, including health checks and the SSE stream.
- **Every route is authenticated**: requests without the token, or with a wrong one, receive `401 UNAUTHORIZED`. Tokens are compared with a constant-time comparison over SHA-256 digests, so neither length nor content leaks through timing.
- **No credentials in query strings or bodies**: the runtime reads the token from headers only.
- **CORS scoped to the webview**: browser cross-origin access is only granted to `vscode-webview://` origins. The extension host itself talks to the runtime without an `Origin`, so CORS does not apply to it; the token is the real gate.
- **Standalone start is never open**: when the runtime is launched by hand without `COMU_RUNTIME_TOKEN`, it generates a token, prints it once to stdout, and requires it.
- **Workspace root comes from the request**: `POST /v1/tasks` requires an absolute, existing `workspace.rootPath`; the runtime never falls back to its own working directory.

---

## 3. Workspace Boundary Protection

Filesystem tools (`read_file`, `write_file`, `edit_file`, `list_directory`, `get_workspace_tree`) enforce strict boundary security:
- **Canonical Path Resolution**: Paths are resolved using `path.resolve` and normalized.
- **Root Confinement**: Traversal attempts outside `workspaceRoot` (e.g. `../../etc/passwd` or `..\..\Windows`) are rejected with `PATH_OUTSIDE_WORKSPACE`.
- **Symlink Escape Detection**: Symlinks pointing outside the workspace boundary are rejected with `SYMLINK_OUTSIDE_WORKSPACE`.

---

## 4. Terminal & Command Execution Security

All terminal actions are governed by `CommandPolicy` and managed by `ProcessManager`:
- **One command path**: every command, from the terminal tool, the validation tools and the git tools alike, is evaluated by `CommandPolicy` and executed by `ProcessManager`. The git tools used to call `ProcessManager` directly, which meant they were neither policy-checked nor cancellable.
- **No shell**: `ProcessManager` never spawns with `shell: true`. The executable is resolved on `PATH` (honouring `PATHEXT`, preferring a real executable over a batch shim) and spawned directly. A Windows `.cmd` shim, which `CreateProcess` cannot run, goes through `cmd.exe /d /s /c` with the whole command line quoted by COMU and passed verbatim; `%` and `^` are rejected by the policy, so the expansion and escaping cmd would otherwise perform cannot be reached.
- **One workspace boundary**: `resolveAndVerifyPath` and `isInsideWorkspace` in `@comu/tool-core` are used by the filesystem tools and the terminal tool alike. The terminal previously used a `startsWith` prefix test, which admitted a sibling directory sharing a name prefix.
- **Cancellation is required, not optional**: `ToolContext.abortSignal` is mandatory and is the only cancellation mechanism. A conformance suite asserts over the whole registry that every tool refuses an aborted signal and writes nothing when cancelled.
- **Allowed Categories**: Only commands classified as `SAFE_DEVELOPMENT` or `OBSERVABILITY` are permitted without elevation.
- **Forbidden Categories**:
  - `FORBIDDEN_DESTRUCTIVE`: Arbitrary deletion or formatting (e.g. `rm -rf /`, `del /f /s /q`).
  - `FORBIDDEN_REMOTE_EXECUTION`: Unrestricted remote scripts (e.g. `curl | bash`).
  - `FORBIDDEN_PERSISTENCE`: System services, startup modifications.
- **Git by subcommand**:
  - Read-only (`status`, `diff`, `log`, `show`, `rev-parse`, `ls-files`, `blame`, …) is allowed to any caller.
  - Mutating (`add`, `commit`, `push`, `checkout`, `switch`, `branch`, `restore`, `stash`) is allowed **only** to COMU's governed git tools, which apply staging limits, commit-message validation and human approval. A model-originated terminal call is refused, so the approval gate cannot be side-stepped by shelling out.
  - Permanently forbidden from every source: `reset --hard`, `clean -f/-d/-x`, `checkout --force`, force/delete/mirror pushes, branch and tag deletion or rename, `rebase`, `filter-branch`, `reflog`, `gc`, `update-ref`, `config`, `pull`, `merge`, `cherry-pick`, `submodule`, `worktree`.
- **Environment Sanitization**: Sensitive environment variables (`AWS_SECRET_ACCESS_KEY`, `OPENAI_API_KEY`, etc.) are stripped from sub-process environments.
- **Output Bounds**: Process standard output and standard error are capped to prevent memory exhaustion and buffer overflows.
- **Timeout & Cleanup**: Commands enforce strict execution timeouts and propagate process tree termination upon cancellation.

---

## 5. Human Interaction Security

- **Task-Scoped**: Interactions cannot be resolved across tasks; interaction requests are strictly bound to their `taskId`.
- **One-Shot Resolution**: Exactly one developer response wins. Subsequent or concurrent submissions are rejected.
- **Fail-Safe Expiration**:
  - A timeout on an `APPROVAL` interaction is treated as **NOT GRANTED**.
  - Silent or implicit permissions are strictly forbidden.
- **Approval Gate (`ApprovalGate`)**: in autonomy `ask`, every model-originated tool call carrying a `write` or `execute` capability (and, in every autonomy, tools marked `requiresApproval: "always"`) is held at `WAITING_FOR_USER` until a human decides. The card carries a reviewable payload: for file tools the proposed unified diff against the pre-mutation content (reusing the baseline read), for commands the exact executable, argument vector and resolved cwd. "Approve for session" is scoped explicitly and each breadth is a distinct grant key: `file:<path>`, `dir:<dir>/`, `writes:*`; for commands `cmd:<executable> <full normalised argv>` (long vectors keep the first two arguments and the count), so `npm run build` never covers `npm run deploy`. Grants live only for the task. Denials are returned to the model as `APPROVAL_DENIED` tool errors. The no-human case is defined: with no event stream subscriber attached, or after the bounded `approvalTimeoutMs`, the decision is a denial. Every decision, including session grants and automatic denials, is journaled as `approval.decided` with its scope key.

---

## 6. ChangeSet & Workspace Integrity Verification

- When a file modification is proposed, COMU captures `baselineHash` and `originalContent`.
- If a mutation fails halfway or produces an OCC conflict, COMU detects `WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE` and aborts.
- During completion gate evaluation, `WorkspaceIntegrityVerifier` audits all modified files against recorded hashes to guarantee workspace consistency.

---

## 7. Memory Security & Anti-Poisoning Defenses

- **External Storage Isolation**: Memory records default to OS application data directories, strictly outside repository trees, preventing accidental Git pollution.
- **Anti-Poisoning Hierarchy**: Repository content cannot arbitrarily become high-trust memory (`USER_VERIFIED` is reserved for explicit human developer actions).
- **Automated Secret Scrubbing**: All candidate memory content is sanitized before persistence; tokens (`ghp_`), keys (`sk-`, `nvapi-`), and bearer credentials are automatically scrubbed with replacement tokens.
- **Freshness & Invalidation**: Stale or contradicted memories lose ranking authority and cannot override verified active workspace evidence.

---

## 8. Controlled Git Security & Push Invariants

- **Gated Execution**: Staging and committing are strictly forbidden before passing the Completion Gate.
- **ChangeSet-Restricted Staging**: Staging is strictly limited to files modified within the task's authorized `ChangeSet`. Wildcard staging (`git add .`) is permanently blocked.
- **Staged Diff Integrity**: `git diff --cached` must match the expected ChangeSet. Any extraneous or unexpected developer changes halt commit immediately.
- **Explicit Push Approval**: `git_push` is marked `requiresApproval: "always"`, so the orchestrator's ApprovalGate holds it for a human decision in every autonomy level, including `auto`; the approval is never grantable for a session. The tool exposes no argument the model could set to pre-authorise a push. With no human attached, the push is denied. Commits are `requiresApproval: "byAutonomy"`.
- **Permanently Forbidden Commands**: `git reset --hard` and `git clean -fd` remain permanently forbidden across all tools and shells.

---

## 9. Subagent Worker Security & Single Execution Authority

- **Strict Depth Invariant**: Workers are single-level (`maxSubagentDepth = 1`). Recursive spawning is blocked at runtime.
- **Master is the Only Writer**: Workers are strictly read-only (`RESEARCH`) or validation-only (`VERIFICATION`). Workers cannot create, edit, or delete files, and cannot execute Git commits or pushes.
- **Strict Capability Enforcement**: All worker tool calls continue through `ToolRegistry` and `ToolExecutor` under strict capability limits.
- **No Orphan Workers**: Cancellation of the parent task instantly aborts all active workers.

---

## 10. Web Documentation Sandboxing & SSRF Defenses

- **Strict Domain Allowlist**: Only explicitly whitelisted official engineering documentation domains (`developer.mozilla.org`, `docs.github.com`, `typescriptlang.org`, etc.) can be queried.
- **Scheme & Protocol**: Only `https:` URLs are permitted; plain `http:` is blocked.
- **SSRF Defenses**: IP destinations and redirects are checked to block loopback (`127.0.0.1`), private IPv4 (`10.*`, `192.168.*`, `172.*`), link-local / cloud metadata (`169.254.169.254`), and IPv6 equivalents.
- **Zero JavaScript Execution**: Fetched HTML is parsed purely as static text; scripts, iframes, styles, and active content are stripped.
- **Strict Resource Bounds**: Requests enforce timeouts, a 2MB maximum payload size, and a 3-hop redirect maximum.

---

## 11. Why these choices

This document states what the guarantees are. The reasoning behind the structural ones, including
the options rejected and the incidents that produced them, is in `docs/decisions/`:

- [0002](decisions/0002-autonomy-model-and-scope-keys.md) and
  [0003](decisions/0003-approval-semantics-and-expiry-as-denial.md) — autonomy, scope keys, and why
  an expired approval is a denial rather than nothing.
- [0004](decisions/0004-one-required-abort-signal.md) — why cancellation is one required signal
  enforced over the whole registry rather than a convention.
- [0008](decisions/0008-the-runtime-is-a-private-local-service.md) — why the runtime has four
  overlapping network controls when two would appear to be enough.
- [0012](decisions/0012-commands-are-allowed-by-name-and-git-by-subcommand.md) and
  [0013](decisions/0013-no-shell-and-windows-shims.md) — why git is decided per subcommand and per
  caller, and why no command ever reaches a shell.
