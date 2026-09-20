# Cancellation propagation audit

**Date:** 2026-09-20. **Scope:** every path that should observe task cancellation.
**Status: findings 1 to 5 are fixed.** See "What was done" at the end. Findings 6 to 8 remain open
and are listed there with what is left.

## Why this audit exists

Phase 3 found that subagent model calls never received the worker's abort signal, so a cancelled
worker reported `FAILED` with the provider's cancellation message instead of `CANCELLED`. That was
not a one-off bug. It was an instance of a structural problem, and this audit confirms the problem
is general.

## Root cause

`ToolContext` carries **two** independent cancellation mechanisms:

```ts
abortSignal?: AbortSignal;
cancellation?: CancellationSignal;   // { isCancelled, onCancel }
```

Nothing requires a tool to observe either one. Which mechanism a tool reads is a matter of whoever
wrote it:

| Tool package | Reads `abortSignal` | Reads `cancellation` | Effect of cancelling mid-call |
| --- | --- | --- | --- |
| `tools/terminal` | yes | yes | process tree killed, correct |
| `tools/validation` | no | yes | process killed, correct **via `cancellation` only** |
| `tools/search` | no | partially | walk stops at the next directory boundary |
| `tools/git` | **no** | **no** | command runs to completion |
| `tools/filesystem` | **no** | **no** | operation runs to completion |
| `tools/web-docs` | **no** | **no** | fetch runs to its own 8s timeout |

The orchestrator happens to supply both, so the tools that read only `cancellation` work today. They
work by coincidence of the current caller, not by contract. Any caller that supplies only an
`AbortSignal` — which is the modern shape, and what `ModelRequestContext` already uses — silently
loses cancellation for validation and search.

**This is the finding that matters.** The individual gaps below are symptoms.

## Findings, worst first

### 1. Git tools ignore cancellation entirely — `tools/git/src/*` (7 files)

Every git tool calls `processManager.start(plan, { timeoutMs })` with **no `abortSignal`**, and none
reads `context.abortSignal` or `context.cancellation`.

Pressing Stop during a git operation does not stop it. The worst case is `git_push`, which has a
30-second timeout: a push the user cancelled can still complete and reach the remote. That directly
weakens the Phase 1 push guarantee — the approval gate stops an *unapproved* push, but once approved
and started, cancellation cannot recall it.

`git_stage_files` (10s) and `git_commit` (10s) have the same shape: a cancelled task can still leave
a commit behind.

### 2. Filesystem tools ignore cancellation — `tools/filesystem/src/*` (7 files)

No references to either mechanism. Most calls are fast enough not to matter, with two exceptions:

- `get_workspace_tree` walks the whole repository and cannot be interrupted.
- `read_file` reads up to the 1 MB limit in one call.

Severity is low but the unbounded walk on a large monorepo is real.

### 3. `web_docs` ignores the task signal — `tools/web-docs/src/doc_reader_tool.ts:109`

It creates its own `AbortController` with an 8-second timeout, which is good, but never links
`context.abortSignal` to it. A cancelled task waits out the remaining fetch timeout.

### 4. Search stops only at directory boundaries — `tools/search/src/backends/node_recursive.ts:34`

The cancellation check sits at the top of `walk`, so a directory with many files is scanned to the
end before the next check. It also reads `cancellation` only, never `abortSignal`, so it is in the
by-coincidence category above.

### 5. Verification mixes the two mechanisms in one call path

`VerificationEngine` checks `ctx.abortSignal?.aborted` between checks, then invokes each validator
through `ctx.toolContext`, whose `cancellation` is what the validation tool actually reads. Correct
today only because the orchestrator populates both. A check already in flight when cancellation
arrives is killed by the validation tool; the *next* check is skipped by the engine. Two mechanisms,
two layers, same call stack.

### 6. Memory writes outlive cancellation — `packages/agent-core/src/orchestrator.ts`

`recordEpisode` on the completion path takes no signal. A cancelled task can still write a memory
entry. Low severity (a local file write), but it means cancellation is not a clean stop.

### 7. The panel can stick on "cancelling" — `apps/vscode-extension/src/providers/chat_provider.ts:364`

`handleCancelTask` sets the local status to `cancelling`, posts the cancel, and then waits for
`task.cancelled` to arrive over SSE. If the runtime is unreachable or the event is lost, the panel
stays in `cancelling` with no timeout and no way back. `sseClient.disconnect()` is never called on
cancel either, so the stream is only torn down when the runtime closes it.

### 8. Cancelling a finished task reports a failure — `apps/agent-runtime/src/server.ts:695`

The cancel route returns 404 once the controller has been removed, and the extension surfaces that
as `Cancel failed: …`. Cancelling something that already finished is not an error worth showing.

## What was done

1. **One mechanism.** `CancellationSignal` is deleted. `ToolContext.abortSignal` is now **required**,
   so a context cannot be constructed without deciding what cancels it; a caller with nothing to
   cancel passes `neverAborted()` and says so. `tool-core` exports `throwIfAborted`, `raceAbort` and
   `abortPromise` so observing the signal is a one-line call rather than a pattern each tool
   reinvents.
2. **Observation is now a contract.** `apps/agent-runtime/tests/tool_conformance.test.ts` iterates
   `registry.getAll()` and asserts every registered tool refuses an already-aborted signal promptly,
   and that none writes to the workspace when cancelled. A tool added later is covered without
   anyone remembering. **Before the fix, 18 of 19 registered tools failed it.**
3. **Git routed through the policy.** All six git tools go through `GitRunner`, which evaluates
   `CommandPolicy` and passes the task's abort signal into `ProcessManager`. The policy understands
   git by subcommand: read-only subcommands are open to anyone, the mutating ones are reserved for
   the governed git tools (so a model cannot commit or push by shelling out past the approval gate),
   and history rewriting, force pushes, hard resets and `clean -f` are refused from every source.
   Cancelling during a push now kills the process tree.
4. **Filesystem, search and web-docs** observe the signal: the filesystem tools refuse at entry,
   `get_workspace_tree` checks per directory, the search walk checks per directory and per file, and
   `web_docs` links the task signal to its own fetch controller instead of waiting out its timeout.
5. **Verification** no longer mixes mechanisms, because there is only one.

### Still open

- **Finding 6, memory writes outlive cancellation.** `recordEpisode` on the completion path still
  takes no signal. Low severity: a local file write, after the decision to stop.
- **Finding 7, the panel can stick on "cancelling".** No timeout and no way out if the runtime is
  unreachable; `sseClient.disconnect()` is still not called on cancel.
- **Finding 8, cancelling a finished task reports a failure.** The runtime's 404 is surfaced to the
  user as an error.

Both extension-side items belong with the interface rebuild rather than the engine, and are noted
for that work.
