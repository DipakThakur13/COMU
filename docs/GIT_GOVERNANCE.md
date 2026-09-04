# COMU Controlled Git Governance

## 1. Overview

Milestone 7 introduces controlled, audited Git governance capabilities in `tools/git`. Developers retain full authority over version control modification, ensuring that autonomous agent actions can never accidentally commit unrelated work, destroy uncommitted code, or push unauthorized commits to remote repositories.

---

## 2. Invariants and Architectural Guarantees

1. **Downstream of Completion Gate:** Git staging and commit operations occur strictly AFTER the task passes all verification checks, workspace integrity verification, and the M6 Completion Gate.
2. **Authorized ChangeSet Invariant:** `stagedFiles ⊆ authorizedChangeSetFiles`. COMU never runs `git add .` or stages wildcard patterns.
3. **Staged Diff Integrity:** `git diff --cached` must match the expected `ChangeSet` diff. If unrelated developer modifications are present in the staged area, commit is immediately blocked.
4. **Push Authorization Invariant:** `git_push` strictly requires explicit human approval (`approved: true`). Autonomous or unattended pushing is impossible by design.
5. **Permanently Forbidden Commands:**
   - `git reset --hard` (Strictly forbidden across all tools and fallback shells)
   - `git clean -fd` (Strictly forbidden across all tools and fallback shells)

---

## 3. Tool Implementations

### `git_create_branch`
- **Input:** Proposed branch name.
- **Safety Validations:**
  - Branch name sanitized against Git ref rules (no control characters, no `..`, no leading slashes, no invalid shell characters).
  - Pre-branch state inspection: Verifies repository is not in detached HEAD, rebase in progress, merge conflict, or cherry-pick in progress.
  - Halts execution and notifies user if Git repository state is ambiguous.

### `git_stage_files`
- **Input:** Specific file list matching authorized `ChangeSet`.
- **Safety Validations:**
  - Blocks `.` or wildcard paths (`*`).
  - Verifies that all requested files were explicitly created or modified within the task's `ChangeSet`.
  - Stages files explicitly using `git add -- <file1> <file2>`.
  - Inspects `git diff --cached --name-only` to guarantee only authorized files are staged.

### `git_commit`
- **Input:** Conventional commit message proposal.
- **Safety Validations:**
  - Evaluates conventional commit format (`feat(...)`, `fix(...)`, `refactor(...)`, etc.).
  - Re-verifies working tree and staged diff against `ChangeSet`.
  - By default, requests developer review and approval in the VS Code UI before executing `git commit`.

### `git_push`
- **Input:** `{ remote, branch, approved: boolean }`.
- **Safety Validations:**
  - If `approved !== true`, push fails with `PUSH_NOT_AUTHORIZED`.
  - Subagents / worker agents are prohibited from calling `git_push`.

---

## 4. Auditability & Observability Events

Every Git governance step emits canonical audit events:
- `git.branch.created`: Emitted when branch isolation is established.
- `git.stage.proposed` & `git.stage.completed`: Logs staged paths and ChangeSet match status.
- `git.commit.proposed` & `git.commit.completed`: Includes commit hash, conventional message, branch, and file count.
- `git.push.requested`, `git.push.completed`, `git.push.denied`: Records remote, branch, and human approval outcome.
