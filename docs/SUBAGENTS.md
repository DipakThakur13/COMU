# COMU Supervised Worker Agents

## 1. Overview

Milestone 7 introduces single-level worker delegation via `SubagentManager` in `@comu/agent-core`. The primary `AgentOrchestrator` can delegate bounded investigations and validation runs to focused worker agents while retaining sole execution, write, and completion authority.

---

## 2. Invariants & Governance Guarantees

1. **Single Execution Authority:** The primary `AgentOrchestrator` remains the single root of execution. Worker agents cannot become independent orchestration roots or declare completion.
2. **Master is the Only Writer:** Worker agents are strictly prohibited from modifying the workspace:
   - No `create_file`, `write_file`, `edit_file`
   - No `git_commit`, `git_push`, `git_create_branch`
   - No arbitrary terminal shell command execution
3. **Strict Depth Invariant (`maxSubagentDepth = 1`):** Worker agents are children of the primary task. Workers MUST NOT spawn child workers. Recursive agent trees are strictly rejected by the runtime.
4. **All Tool Execution Governed:** Every worker tool call passes through `ToolRegistry`, `ToolExecutor`, and standard capability permissions.
5. **Budget Inheritance:** Worker steps and tool calls count towards parent task resource budgets.

---

## 3. Worker Specializations

### RESEARCH Worker
- **Goal:** Investigate architecture, dependencies, search codebases, and retrieve official documentation.
- **Allowed Tools:**
  - `read_file`
  - `list_directory`
  - `search_text`
  - `get_workspace_tree`
  - `web_docs`
- **Capabilities:** `read`, `execute` (read-only queries).
- **Output:** Structured findings, affected files, URLs visited, and evidence summaries.

### VERIFICATION Worker
- **Goal:** Execute authorized deterministic validation checks and inspect repository diffs.
- **Allowed Tools:**
  - `read_file`, `list_directory`
  - `run_tests`
  - `run_build`
  - `run_linter`
  - `run_typecheck`
  - `git_status`, `git_diff`
- **Capabilities:** `read`, `execute` (predefined validation runners only).
- **Output:** Check status results, error logs, and validation evidence.

---

## 4. Cancellation & Error Propagation

- **Parent Cancellation:** Cancelling the primary task triggers immediate cancellation signals (`AbortSignal`) to all active workers.
- **Process Cleanup:** Running subprocesses managed by workers are immediately terminated via `ProcessManager`.
- **Fault Tolerance:** If a worker encounters an error or reaches its step budget, the failure is returned to the master orchestrator as structured evidence. A worker failure does not corrupt the parent task.
