# COMU Architecture Specification

## 1. System Overview

COMU is an Autonomous AI Software Engineer designed for VS Code, built with a TypeScript monorepo managed with PNPM workspaces.

The platform architecture follows a layered design ensuring strict security boundaries, optimistic concurrency control (OCC), deterministic command policies, and unified streaming observability.

```text
                                  USER (VS Code / CLI)
                                           │
                                           ▼
                                   AgentOrchestrator
                                           │
        ┌───────────────────┬──────────────┴───────────────┬───────────────────┐
        ▼                   ▼                              ▼                   ▼
  PlanningEngine    VerificationEngine            DiagnosticsEngine       RepairEngine
        │                   │                              │                   │
        │                   ▼                              ▼                   │
        │             ToolExecutor ──────────────┐   Fingerprinting ───────────┘
        │                   │                    │
        ▼                   ▼                    ▼
   TaskPlan           Controlled Tools   FailureDiagnosis
        │                   │
        │     ┌─────────────┼─────────────┐
        │     ▼             ▼             ▼
        │  Filesystem    Terminal        Git
        │  (OCC/Diff) (CommandPolicy) (Read-only)
        │                   │
        │                   ▼
        │              Validation
        │         (Tests/Lint/Typecheck)
        │                   │
        └───────────────────┴──────────────┐
                                           ▼
                                   Workspace Integrity
                                           │
                                           ▼
                                    Completion Gate
                                           │
                                           ▼
                                       COMPLETED
```

---

## 2. Monorepo Package Layout

### Core Packages (`packages/`)
- `@comu/protocol`: Canonical interfaces, event schemas (`AgentEvent`), state models, and message contracts.
- `@comu/model-core`: ModelProvider abstraction, tool calling definitions, message normalization.
- `@comu/tool-core`: `ToolRegistry`, `ToolExecutor`, `ToolContext`, security capabilities, execution metrics.
- `@comu/diff-engine`: `ChangeSet` tracking, optimistic concurrency control, line diff computation.
- `@comu/agent-core`: `AgentOrchestrator`, agent loop, state machine, and interaction coordination.
- `@comu/context-engine`: Context reduction, prompt assembly, and token budgeting.
- `@comu/shared`: Common error classes, utilities, and assertions.

### Milestone 6 & 7 Orchestration & Intelligence Engines (`packages/`)
- `@comu/planning-engine`: Task analysis, structured plan generation, dependency validation (cycle detection), versioned step state management, and dynamic mutation.
- `@comu/verification-engine`: Deterministic verification policy (test, typecheck, build, lint), check execution through `ToolExecutor`, workspace integrity evaluation, and result aggregation.
- `@comu/diagnostics-engine`: Evidence collection, failure classification, affected-file extraction, and deterministic fingerprinting (`failureFingerprint`, `repairStrategyFingerprint`, `repairAttemptFingerprint`).
- `@comu/repair-engine`: Bounded repair governance, attempt tracking, duplicate repair prevention, and scope control.
- `@comu/memory-engine`: Persistent workspace intelligence, OS application data storage, 5-tier trust hierarchy, BM25/trust/freshness ranking, and automated secret sanitization.

### Providers (`providers/`)
- `@comu/provider-nvidia`: NVIDIA Nemotron integration using OpenAI-compatible endpoints with dynamic key configuration.

### Tool Implementations (`tools/`)
- `@comu/tool-filesystem`: Safe file operations (`read_file`, `write_file`, `edit_file`, `list_directory`, `get_workspace_tree`) enforcing workspace root confinement and path traversal defenses.
- `@comu/tool-search`: Workspace grep and file search (`search_text`).
- `@comu/terminal`: Controlled terminal tool (`run_command`), `CommandPolicy` enforcement, process lifecycle management (`ProcessManager`), timeout/cancellation, and output bounding.
- `@comu/git`: Controlled Git governance (`git_status`, `git_diff`, `git_create_branch`, `git_stage_files`, `git_commit`, `git_push`) enforcing ChangeSet-only staging and explicit push approval.
- `@comu/validation`: Project detector (`ProjectDetector`), command resolver (`CommandResolver`), and controlled validation tools (`run_tests`, `run_build`, `run_linter`, `run_typecheck`).
- `@comu/tool-web-docs`: Sandboxed documentation access enforcing canonical domain allowlists and comprehensive SSRF defenses.

### Applications (`apps/`)
- `agent-runtime`: Express-based HTTP/SSE daemon hosting task sessions, SSE event streams, interaction endpoints, memory endpoints (`GET/POST/DELETE /v1/workspace/memory`), and subagent inspection.
- `vscode-extension`: VS Code Extension Host and Webview frontend providing interactive chat, plan visualization, verification matrix, memory panels, supervised worker monitoring, and gated Git review cards.

---

## 3. Milestone 7 Architecture: Persistent, Governed, Extensible Platform

Milestone 7 upgrades COMU into a persistent, governed engineering platform:
```text
USER
 ↓
COMU
 ↓
RETRIEVE VERIFIED PROJECT KNOWLEDGE
 ↓
PLAN
 ↓
OPTIONAL RESEARCH WORKER (Read-only + Web Docs)
 ↓
IMPLEMENT (Master Only)
 ↓
VERIFY (Verification Worker / Engine)
 ↓
DIAGNOSE / REPAIR
 ↓
COMPLETION GATE
 ↓
GIT PROPOSAL
 ↓
USER REVIEW
 ↓
CONTROLLED COMMIT (ChangeSet Staged Diff Verified)
 ↓
OPTIONAL HUMAN-APPROVED PUSH
```

### 3.1 Single Execution Authority & Write Path Invariant
- `AgentOrchestrator` remains the single execution authority.
- Supervised workers are strictly single-level (`maxSubagentDepth = 1`). Recursive worker spawning is impossible.
- Master is the ONLY writer: Workers cannot create, edit, or delete files, and cannot commit or push.

### 3.2 Controlled Git Governance
- All Git modification occurs downstream of engineering verification and the Completion Gate.
- Staging invariant: `stagedFiles ⊆ authorizedChangeSetFiles`. Wildcards (`git add .`) are permanently blocked.
- Cached diff verification: `git diff --cached` must match the authorized ChangeSet before `git commit` proceeds.
- Push invariant: `git_push` strictly requires explicit human approval (`approved: true`).
- Destructive commands (`git reset --hard`, `git clean -fd`) remain permanently forbidden.

### 3.3 Persistent Workspace Intelligence (Memory Engine)
- Memory is stored outside the repository in the OS application data directory keyed by stable workspace hash.
- Strict 5-tier trust hierarchy: `USER_VERIFIED > VERIFIED_EVIDENCE > TASK_VERIFIED > AGENT_DERIVED > UNVERIFIED`.
- Deterministic token, trust, freshness, and scope ranking without external vector DB dependencies.
- Secrets, tokens, and private credentials are automatically redacted before persistence.

### 3.4 Sandboxed Web Documentation Access
- Restricted to approved documentation domains (`developer.mozilla.org`, `docs.github.com`, `typescriptlang.org`, etc.).
- SSRF defenses block loopback, private IPv4/IPv6, link-local, cloud metadata, and redirection bypasses.
- Zero JavaScript execution: Documents are parsed purely as static text/HTML into bounded markdown.

