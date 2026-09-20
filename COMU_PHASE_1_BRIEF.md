# COMU Phase 1 Brief: Make the Safety Promises True

Phase 0 is complete and verified. Seven commits on `main`, gate green, nothing pushed.

This brief covers the lint prerequisite and Phase 1. Read `COMU_CLAUDE_CODE_BRIEF.md` for the overall engagement rules, which still apply: read before you write, no stub that presents as working, every fix gets a regression test, small reviewable commits, update the README when a claim becomes true or false.

**Phase 1 theme:** COMU currently auto executes every file write and every command while presenting itself as a supervised agent. The approval infrastructure is already built and wired end to end. It is simply never called. Your job is to make the product as safe as it looks.

---

## Task 1 · Lint configuration (do this first, it is a prerequisite)

`pnpm lint` has never been green because the repository has no ESLint config at all. Normally that would be a chore to defer. It is a prerequisite here for a specific reason: **Phase 1.2 is entirely async approval gating, and type aware linting catches exactly that bug class.**

Add typescript-eslint with type aware parsing (`parserOptions.project`). Accept the slower runtime.

**Error on these four rules only:**
- `@typescript-eslint/no-floating-promises` — catches an approval call that is never awaited, which would let a write proceed while the card is still open. This is the single most likely Phase 1.2 defect.
- `@typescript-eslint/no-misused-promises` — catches an async callback passed where a void return is expected. Already a live pattern via `abortSignal.addEventListener("abort", cb)`.
- `@typescript-eslint/await-thenable`
- `no-async-promise-executor` — will flag `packages/tool-core/src/executor.ts`, where the timeout race uses `new Promise(async (resolve, reject) => ...)`.

**Warn on:** `@typescript-eslint/no-unused-vars`.

**Off:** every stylistic rule. Prettier is already a devDependency and owns formatting. Do not add a formatting opinion.

**Rules of engagement:**
- Config goes in its own commit with **no** code fixes in it.
- Before fixing anything, report how many violations exist and what classes they fall into.
- Then fix in small follow up commits grouped by class, not one giant sweep.
- If a rule produces overwhelming noise for little value, tell me and we will drop it rather than suppress it file by file.

---

## Task 2 · Phase 1.1: Enforce the permission contract

### The bug
Phase 0.4 now produces a correct `TaskContract` with the right capabilities per mode. ASK and PLAN get `["read"]`; AGENT gets `["read", "write", "execute"]`. The orchestrator then ignores it completely.

Three separate leaks in `packages/agent-core/src/orchestrator.ts`, in `runWithContract`:

1. **The tool context hardcodes full permissions.** `toolCtx` is built with `permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "DENY" } }` regardless of the contract.
2. **The contract validating path is never used.** The tool loop calls `this.executor.execute(tc.name, tc.arguments, toolCtx)` directly. `ToolExecutor.processModelToolCall()` in `packages/tool-core/src/executor.ts` is the only method that calls `validateContract`, and nothing calls it. `validateTaskContract()` in `packages/agent-core/src/interaction/task_contract.ts` is therefore dead code.
3. **The model is offered every tool regardless of mode.** `const tools = this.registry.getAll().map(...)` sends the full registry, so an ASK task still sees `write_file`, `edit_file` and `execute_command` in its tool list and will happily call them.

The only thing currently stopping a write in PLAN mode is the state machine guard blocking `TOOL_CALLING` for CHAT and PLAN. ASK is not blocked and has full write and execute permission.

### The fix
- Derive `toolCtx.permissions` from `contract.allowedCapabilities`. A capability absent from the contract is `DENY`.
- Route model originated tool calls through the contract validating path so `validateTaskContract` actually runs, or inline an equivalent check before execution. Prefer using the existing method so there is one enforcement point, not two.
- **Filter the tool list sent to the model** by the contract's capabilities. A read only task should never see a mutating tool. This is defence in depth: filtering prevents the attempt, enforcement catches it if the model hallucinates a tool name anyway.
- Remember the `delegate_subtask` pseudo tool, which is pushed onto the `tools` array manually after the registry map. Gate it the same way.
- Verify the subagent path too. `SubagentManager.getWorkerCapabilities()` declares `allowedTools` for RESEARCH and VERIFICATION workers. Confirm that list is actually enforced when the worker runs, not just declared.

### While you are here
`tools/web-docs` declares the `execute` capability rather than `network`. That miscategorisation is currently load bearing, because the orchestrator hardcodes `network: "DENY"` and the tool would otherwise be blocked. Fix the capability to `network` and make the contract grant network where appropriate, so the categories mean what they say.

### Tests
- An ASK task that attempts `write_file` is rejected with a contract error and the task continues sensibly.
- An ASK task's tool list contains no mutating tools.
- An AGENT task is unaffected.
- A PLAN task still cannot enter `TOOL_CALLING`.

---

## Task 3 · Phase 1.2: Autonomy levels and real approval cards

### The bug
`InteractionManager.requestApproval()` exists and is fully implemented. The runtime exposes `GET /v1/tasks/:id/interactions` and `POST /v1/tasks/:taskId/interactions/:interactionId/respond`. The extension relays `respond_interaction`. The webview renders a pending interaction with options and calls `respondInteraction()`. The completion gate already checks `noPendingInteraction`. The state machine already has a `WAITING_FOR_USER` state.

Every piece is built. The orchestrator never calls `requestApproval`. It only calls `getPendingInteraction` at the very end, to check nothing is outstanding.

### Introduce autonomy levels
Three levels: `readonly`, `ask`, `auto`.

- Add `autonomy` to `TaskRequest` alongside the `mode` field you added in Phase 0.4.
- Surface it as a selector in the composer next to mode and model.
- Persist the user's default in extension settings.
- `readonly` implies a read only contract regardless of mode. `auto` is today's behaviour. `ask` is the new default for AGENT tasks.

### The approval gate
In `ask` mode, before executing any tool carrying a `write` or `execute` capability, raise an approval interaction and block on the response.

**The card must be reviewable.** An approval that says "the agent wants to run a tool" is useless. Carry a real payload:
- For a write or edit: the target path and the **proposed diff** against current file content. You will need to compute this before the mutation rather than after. The `DiffEngine` and the existing before and after read pattern give you the material.
- For a command: the exact `executable`, `args` array and resolved `cwd`. Never a reconstructed shell string, because the whole point of the policy is that there is no shell.

**Responses:** Approve, Approve for session, Edit, Deny.

- **Approve for session** must be scoped, not global. Scope it per task and per tool name, and for `execute_command` additionally per command signature (executable plus first argument). Approving `npm test` once must not silently approve `npm publish` later.
- **Edit** lets the user amend the proposed content or command before it runs. If that is too large for this pass, implement Approve, Approve for session and Deny, and leave Edit as an explicit TODO with a note. Do not fake it.
- **Deny** must return a tool error to the model so it can adapt or choose another approach. It must not hard fail the task. A denial is information, not a crash.

### State machine detail you will hit
The current transition map in `orchestrator.ts` is:

```
TOOL_CALLING: ["OBSERVING", "CANCELLED", "FAILED", "LIMIT_REACHED"]
```

Approval happens immediately before tool execution, so you need `TOOL_CALLING -> WAITING_FOR_USER` and `WAITING_FOR_USER -> TOOL_CALLING` added to the map. Check the rest of the table for the same gap rather than patching one entry and discovering the next at runtime.

### Other things to get right
- **Cancellation while waiting.** If the user cancels the task while an approval is pending, the interaction must resolve and the loop must unwind cleanly. `cancelTaskInteractions` already exists; make sure it is reached.
- **Timeout.** Decide what a pending approval does after a long wait. Blocking forever is acceptable for an interactive session, but the 5 minute `maxExecutionTimeMs` cap will fire underneath you. Waiting on a human must not count against execution time. Either pause the clock or exclude waiting time from the budget.
- **Do not spam.** A task touching twenty files should not produce twenty modal interruptions. Approve for session is the mitigation; make it prominent in the card.

### Tests
- An AGENT task in `ask` mode pauses at `WAITING_FOR_USER` before the first write, and the emitted interaction carries a diff.
- Approving over HTTP resumes execution and the write lands.
- Denying returns an error to the model and the task continues rather than failing.
- Approve for session suppresses the second approval for the same tool but not for a different command signature.
- Cancelling while an approval is pending unwinds cleanly.
- `auto` mode raises no approvals at all.

---

## Task 4 · Phase 1.3: Git push approval is theatre

`tools/git/src/git_push_tool.ts` declares that push "strictly requires explicit human approval", then gates on an `approved: boolean` field in the tool's own input schema. The model supplies that field. It can simply set it to true. There is no human anywhere in the path.

- Remove the self asserted `approved` argument entirely.
- Route push through the real approval gate from Task 3.
- Push should require approval **even in `auto` autonomy**. Introduce a per tool marker such as `requiresApproval: "always" | "byAutonomy"` so a tool can opt into an unconditional gate. Push is `always`. Commit is `byAutonomy`.

Note that `ToolContext` currently has no approval hook, so tools cannot request approval themselves. Prefer gating centrally in the orchestrator by capability and by the tool's `requiresApproval` marker, rather than threading the interaction manager into every tool. One enforcement point.

---

## Task 5 · Phase 1.4: Unify the command execution paths

Three related defects in the same area.

### 5a. Git tools bypass the command policy
`tools/git/src/*` construct a `CommandPlan` and call `ProcessManager.start()` directly. `CommandPolicy.evaluate()` is never consulted, because `git` is not on the `SAFE_EXECUTABLES` allowlist and would be denied. So there are two command execution paths with different safety properties.

Add `git` to the allowlist with subcommand awareness. Some git subcommands are not safe to treat as routine: `push`, `reset --hard`, `clean -fd`, `checkout --force` and anything that rewrites history. Deny or gate those, allow the read only and staging subcommands. Then route the git tools through the policy like everything else.

### 5b. The terminal boundary check is weaker than the filesystem one
`tools/terminal/src/terminal_tool.ts` validates the working directory with:

```ts
if (!normalize(targetCwd).startsWith(normalize(rootPath)))
```

A prefix test lets a sibling directory through: root `/home/me/proj` admits `/home/me/proj-evil`. The filesystem tools already do this correctly in `tools/filesystem/src/security.ts`, using `path.relative` plus a `..` check plus realpath symlink resolution.

Extract `resolveAndVerifyPath` into a shared package and use it in both places. One boundary implementation, not two.

### 5c. Windows runs through a shell
`ProcessManager` spawns with `shell: process.platform === 'win32'`. The injection filter blocks ``; & | > < $ ` $(`` but does not cover the Windows `%VAR%` expansion or the caret escape character. The allowlist limits the blast radius, but the codebase's own comment acknowledges this is a compromise.

Move to a shell free spawn with explicit executable resolution on Windows. The `.cmd` shim problem for npm, pnpm and yarn is the reason the shell is there, so resolve those explicitly rather than delegating to cmd.exe. `tools/validation/src/command_resolver.ts` already appends `.cmd` on win32, so there is a precedent to follow and consolidate.

---

## Task 6 · Log a finding, do not fix it

You discovered during Phase 0.5 that **COMU has no token level streaming anywhere**. Providers accumulate deltas internally in `parseStream` and return a completed `ModelResponse`, and the protocol has no token delta event. The UI has therefore never rendered streaming text.

Add a note to `COMU_CLAUDE_CODE_BRIEF.md` under Phase 3 recording this, with the shape of the eventual fix: a `model.token_delta` event in the protocol and an `onDelta` callback on the provider interface, so the webview can render text as it arrives. A dynamic interface where the assistant's reply appears in one block after a long pause will feel dead regardless of how good the components are.

Do not implement it in this phase.

---

## Definition of done for Phase 1

- `pnpm lint` runs and passes, with a config that catches async correctness rather than formatting.
- An ASK task **cannot** write a file or run a command, and is never offered the tools to try.
- An AGENT task in `ask` autonomy **pauses before its first write**, shows a diff, and proceeds only on approval.
- Denying an action teaches the model rather than killing the task.
- `git push` cannot happen without a human, in any autonomy level.
- There is **one** command execution path and **one** workspace boundary implementation.
- Typecheck, lint, test and build are all green.
- The README's "Interactive Human in the Loop Cards" claim is now true.

---

## How to proceed

1. Do Task 1, report the violation count and classes, and wait before fixing.
2. Then Task 2, which is self contained and low risk.
3. Then Task 3, which is the real work of this phase. Propose your design for the approval payload and the session scoping before you implement it.
4. Tasks 4 and 5 follow naturally once the gate exists.
5. Report back with what changed, what you verified, and what surprised you.

Ask me before making any architectural decision not specified here.
