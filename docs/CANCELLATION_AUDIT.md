# Cancellation propagation audit

**Date:** 2026-09-20. **Scope:** every path that should observe task cancellation.
**Status:** findings only. Nothing here is fixed; this document exists so the fixes can be
scheduled deliberately rather than discovered one at a time.

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

## What the shape of the fix looks like

Not done in this phase, recorded so the intent is not lost:

1. **Collapse to one mechanism.** `AbortSignal` is the standard, already used by
   `ModelRequestContext`, and composes with `AbortSignal.any()`. Keep `CancellationSignal` as a thin
   derived view for existing callers, or remove it.
2. **Make observation a contract, not a convention.** Options: have `ToolExecutor` reject a tool that
   declares long-running work without declaring cancellation support, or supply tools with a
   pre-wired helper (`ctx.throwIfCancelled()`, `ctx.fetch()`, `ctx.runProcess()`) so the correct
   behaviour is the default rather than something each tool must remember.
3. **Route git through the command policy** (already on the Phase 1 list as task 5a). Doing that
   fixes finding 1 as a side effect, because the terminal path is the one that handles abort
   correctly.
4. **A test per tool package** asserting that a call cancelled mid-flight rejects promptly. The
   absence of such a test is why six packages drifted.
5. **Extension**: bound the `cancelling` state with a timeout and a way out, and treat a 404 from
   the cancel route as already-finished rather than an error.
