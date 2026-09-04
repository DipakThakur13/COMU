# COMU Persistent Workspace Intelligence (Memory Engine)

## 1. Overview

Milestone 7 introduces `@comu/memory-engine` — a persistent, cross-task engineering intelligence store. It enables COMU to retain verified conventions, architectural facts, lessons learned from verification and repair, and task episodes across sessions without polluting the developer's repository.

---

## 2. Storage Architecture

### OS Application Data Directory
Memory is stored outside the workspace repository by default to prevent accidental commits of local state or metadata:

- **Windows:** `%LOCALAPPDATA%/comu/workspaces/<workspaceHash>/memory/`
- **macOS:** `~/Library/Application Support/comu/workspaces/<workspaceHash>/memory/`
- **Linux:** `~/.local/share/comu/workspaces/<workspaceHash>/memory/`

### File Layout
Within each workspace's memory directory:
- `conventions.json`: Structured conventions (coding standards, framework rules).
- `lessons.json`: Verifiable lessons derived from repairs and completions.
- `episodes.jsonl`: Bounded task execution summaries with evidence references.

### Atomic & Resilient Persistence
- Atomic writes: Uses `.tmp` scratch files followed by atomic filesystem rename operations.
- Corruption recovery: Corrupted records trigger backup generation (`.corrupt-<timestamp>`) rather than silent overwrite.

---

## 3. Trust Hierarchy

Memory entries enforce an immutable trust hierarchy:

```text
USER_VERIFIED
     │
     ▼
VERIFIED_EVIDENCE
     │
     ▼
TASK_VERIFIED
     │
     ▼
AGENT_DERIVED
     │
     ▼
UNVERIFIED
```

### Trust Rules:
1. **Model Authority Invariant:** The LLM cannot directly set or elevate `trustLevel`.
2. **User Explicit Input:** Human user instructions received via API or UI are assigned `USER_VERIFIED`.
3. **Verified Repository Findings:** Tool scans (e.g. `package.json` packageManager) produce `VERIFIED_EVIDENCE`.
4. **Task Completion Output:** Verified repair and completion loops create `TASK_VERIFIED` lessons.
5. **Model Inferences:** Model assumptions or heuristics are strictly tagged `AGENT_DERIVED` or `UNVERIFIED`.
6. **Conflict Resolution:** Higher trust levels strictly outrank lower trust levels. Active verified workspace evidence outranks stale memory.

---

## 4. Freshness and Invalidation

Every memory entry tracks:
- `createdAt`, `updatedAt`, `verifiedAt`, and optional `invalidatedAt`.
- `status`: `"ACTIVE" | "STALE" | "INVALIDATED"`.
- `scope`: `{ workspaceId, branch?, files? }`.

### Lifecycle Signals:
- When a relevant file or dependency changes, memory is flagged `STALE`.
- Stale memory remains stored for auditability, but its retrieval rank is penalized and it cannot override fresh evidence.
- When contradicted by verified evidence or explicit developer action, memory is `INVALIDATED` and excluded from model context.

---

## 5. Deterministic Retrieval & Ranking

COMU uses deterministic local retrieval without external vector databases or cloud embedding dependencies:

$$\text{Score} = \text{TokenRelevance} \times 0.4 + \text{TrustWeight} \times 0.3 + \text{FreshnessWeight} \times 0.2 + \text{ScopeWeight} \times 0.1$$

- Bounded Top-K: Only top-scoring verified active entries are injected as supplementary context into the orchestrator.
- Invariant: Workspace files remain authoritative ground truth over memory.

---

## 6. Secret Sanitization & Anti-Poisoning

### Sanitization Before Persistence:
Every memory candidate is scrubbed for:
- GitHub personal access tokens (`ghp_`, `gho_`, etc.)
- Provider API keys (`sk-`, `nvapi-`, etc.)
- Bearer tokens and authorization headers
- Sensitive environment variables and private credentials

### Anti-Poisoning Defenses:
- Repository READMEs, issues, or comments cannot arbitrarily become `USER_VERIFIED`.
- Malicious instructions embedded in repository files are relegated to `UNVERIFIED` or `AGENT_DERIVED` and cannot override safety invariants.
