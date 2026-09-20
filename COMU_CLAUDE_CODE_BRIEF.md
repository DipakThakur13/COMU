# COMU Engineering Brief for Claude Code

You are the lead engineer on **COMU**, an open source, model agnostic AI software engineering workspace that ships as a VS Code extension plus a local Node agent runtime. The repository is a pnpm monorepo at the current working directory.

Your mission has two halves, in this order:

1. **Make the agent actually correct, safe and capable.** A recent engineering audit found that the scaffolding is good but several load bearing parts are disconnected, stubbed or unsafe.
2. **Rebuild the user interface as a dynamic, component driven application.** No more hand written static HTML with manual DOM manipulation.

Do not start half two until the Phase 0 blockers in half one are closed, because a beautiful interface narrating a broken process is worse than no interface.

---

## Ground rules

- **Read before you write.** Inspect the real file before changing it. Never guess at an API or a symbol.
- **No invented capability.** If you cannot implement something properly, say so and leave a clear TODO. Never ship a stub that presents as working. Several current defects are exactly this failure.
- **Every fix gets a test.** The repo uses vitest and already has about 325 test cases across 36 files. Add regression tests that fail before your change and pass after.
- **Keep the build green.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` before you consider any task done.
- **Small, reviewable commits.** One logical change per commit with a clear message. Do not bundle unrelated fixes.
- **Preserve what works.** The model request manager, filesystem safety layer, terminal command policy, plan validator, repair engine, diagnostics fingerprinting, memory store and typed event protocol are all good. Extend them; do not rewrite them.
- **Update the README as you go.** It currently claims capabilities that do not exist. Every time you make a claim true, or remove a false one, fix the README in the same commit.

---

## PHASE 0 · Critical blockers (do these first, in order)

### 0.1 The agent operates on the wrong directory
**File:** `apps/agent-runtime/src/server.ts`, the `POST /v1/tasks` handler.
**Bug:** It sets `const workspaceRoot = resolve(process.cwd())` and completely ignores `taskReq.workspace`, which the extension already sends correctly from `getWorkspaceContext()`. The extension spawns the server with no `cwd` set, so the server inherits the extension host working directory, which is not the user project.
**Fix:** Use `taskReq.workspace.rootPath` as the authoritative workspace root. Validate and normalise it. Reject a task with no workspace. Pass it into `OrchestratorContext.workspaceRoot`.
**Test:** A task against a fixture repository must resolve every file read, file write and command working directory under that path, and must never touch `process.cwd()`.

### 0.2 The runtime is an unauthenticated open server
**File:** `apps/agent-runtime/src/server.ts`, plus `apps/vscode-extension/src/runtime/server_process_manager.ts` and `runtime_client.ts`.
**Bug:** `app.listen(port)` binds all interfaces, `cors()` is wide open, and no route checks any credential. Any local process can create tasks that read and write workspace files and run commands. The extension sends an `X-NVIDIA-API-KEY` header that the server never validates, so it is not authentication.
**Fix:** Bind to `127.0.0.1` only. Generate a random per session token in the extension, pass it to the spawned server through the environment, require it on every route using a constant time comparison, and scope CORS to the webview origin.
**Test:** A request without the token returns 401. A request from a non loopback address is refused. The extension still works.

### 0.3 Ollama is advertised but runs NVIDIA with a dummy key
**File:** `apps/agent-runtime/src/server.ts`, provider selection inside the task runner.
**Bug:** The provider catalogue lists Ollama as always connected and local, but the task runner has no Ollama branch. A local model id falls through to the else branch and constructs `new NvidiaProvider(key, endpoint)` with `"dummy-key"`, so choosing local produces an NVIDIA authentication failure.
**Fix:** Implement a real Ollama provider. `OpenAICompatibleProvider` already does almost all of the work, so point it at the local Ollama OpenAI compatible endpoint with its own capability profile and no API key requirement. If you cannot complete it, remove the option and the README claim instead of leaving it broken.
**Test:** A task with a local model runs against a local Ollama instance end to end and never contacts NVIDIA.

### 0.4 The user chosen mode is thrown away
**Files:** `apps/vscode-extension/src/providers/chat_provider.ts` (`handleSubmitPrompt`), `packages/protocol/src/index.ts` (`TaskRequest`), `packages/agent-core/src/agent_kernel.ts`.
**Bug:** The webview sends a `mode` of AUTO, AGENT, PLAN, ASK or CHAT, but `createTask` never puts it in the request body. The kernel then always reclassifies with `IntentRouter`, which is pure regex. So the mode dropdown is decorative and a prompt like "please fix the login bug" falls through every regex and becomes AMBIGUOUS.
**Fix:** Add `mode` to `TaskRequest`, send it, and have `AgentKernel.handle` honour an explicit mode and skip classification entirely. Keep the router only for AUTO.
**Test:** Selecting AGENT forces AGENT regardless of prompt wording.

### 0.5 Chat mode does not call a model
**File:** `packages/agent-core/src/agent_kernel.ts`.
**Bug:** CHAT returns the hardcoded string `"Hi! I'm COMU, your AI software engineer. What are we working on?"` with a comment admitting there is no model call.
**Fix:** Make CHAT perform a real model call with a light conversational system prompt and no tools, streaming the response back through the normal event path.

### 0.6 Intent classification is brittle regex
**File:** `packages/agent-core/src/interaction/intent_router.ts`.
**Bug:** Classification is a chain of regexes anchored at the start of the string. Anything starting with "please", "could you", "I need" and so on falls through to AMBIGUOUS and the user gets a clarification prompt for a perfectly clear request.
**Fix:** Keep the deterministic fast path for obvious cases, then fall back to a cheap model classification call rather than to AMBIGUOUS. Only ask for clarification when the model is genuinely uncertain.

---

## PHASE 1 · Make the safety promises true

### 1.1 The permission contract is never enforced
**Files:** `packages/agent-core/src/orchestrator.ts`, `packages/tool-core/src/executor.ts`.
**Bug:** The orchestrator calls `executor.execute()` directly, which bypasses `processModelToolCall()`, the only path that validates the `TaskContract`. It also hands every tool a context with `{ read: "ALLOW", write: "ALLOW", execute: "ALLOW" }` regardless of mode. So ASK and PLAN modes, which are documented as read only, can still write files and run commands.
**Fix:** Route model originated tool calls through the contract validating path. Derive `toolCtx.permissions` from the contract. Also filter the tool list sent to the model so a read only mode never even sees `write_file` or `execute_command`.
**Correction (found while fixing, 2026-09-20):** the audit assumed the state machine guard blocked `TOOL_CALLING` for PLAN. It never enforced anything: the `TOOL_CALLING` transition was made without passing the contract, so the guard never saw a mode. Both ASK and PLAN were exposed, not ASK alone. Fixed in Phase 1.1 together with the contract enforcement.

### 1.2 Approval cards are fully built and never shown
**Files:** `packages/agent-core/src/interaction_manager.ts`, `orchestrator.ts`.
**Bug:** `InteractionManager.requestApproval()` exists and is wired end to end through the runtime endpoint, the extension relay and the webview handler. The orchestrator never calls it. It only checks `getPendingInteraction` in the completion gate. So the agent auto executes every write and command while the product presents itself as supervised.
**Fix:** Introduce an **autonomy level**: `readonly`, `ask`, `auto`. In `ask` mode, before any tool with a write or execute capability, raise an approval interaction carrying the proposed diff or the exact command, and block on the response. Support Approve, Approve for session, Edit and Deny. Wire the autonomy selector into the composer.

### 1.3 Git push approval is theatre
**File:** `tools/git/src/git_push_tool.ts`.
**Bug:** The tool claims it "strictly requires explicit human approval" but the gate is an `approved: boolean` in the tool arguments, which the model itself supplies. The model can simply set it to true.
**Fix:** Remove the self asserted flag and route push through the real `InteractionManager` approval from 1.2. Do the same for commit when autonomy is not `auto`.

### 1.4 Unify the command execution paths
**Files:** `tools/terminal/src/`, `tools/git/src/`.
**Bug:** Terminal and validation commands go through `CommandPolicy`, but the git tools build a `CommandPlan` and call `ProcessManager` directly, bypassing policy entirely. Two paths with different safety properties.
**Also fix:** The terminal workspace boundary check uses `normalize(cwd).startsWith(normalize(root))`, which lets a sibling directory with a shared name prefix through. The filesystem tools already do this correctly with `path.relative`. Extract that helper and use it everywhere.
**Also fix:** `ProcessManager` spawns with `shell: process.platform === 'win32'`. The injection filter does not cover the Windows `%VAR%` expansion or the caret escape character. Move to a shell free spawn with explicit `.cmd` resolution on Windows.

---

## PHASE 2 · Give the agent a real brain

### 2.1 Context is unbounded and the Context Engine is dead code
**Files:** `packages/agent-core/src/orchestrator.ts`, `packages/context-engine/src/engine.ts`.
**Bug:** This is the single biggest capability ceiling. The orchestrator appends every assistant turn and every tool result to a `messages` array and sends the whole thing on every iteration. There is no tokeniser, no budget, no truncation, no compaction. A single `read_file` can return up to 1 MB. Meanwhile `ContextEngine.compile()` exists, ranks files, builds a repository map, and is **never called by anything on the execution path**. `WorkingSetManager` only feeds the UI.
**Consequence:** On any task of real length the request exceeds the model window, the provider returns 400, the request manager correctly marks it non retryable, and the task fails hard. The advertised 1.05M token support is a profile constant, not a managed budget.
**Fix:**
- Make `ContextEngine.compile()` the single source of the model prompt.
- Add a real token budget per provider using a tokeniser or a calibrated heuristic.
- Rank and include working set content by relevance and recency.
- Summarise or evict the oldest tool outputs when the budget is approached.
- Maintain a compact **rolling task state** (goal, plan, current step, key findings, open questions, files touched) that always survives compaction.
- Truncate very large tool results at the history level with a pointer the model can re expand.
**Test:** A task that reads 50 files and runs a long test suite completes without overflow, with request tokens staying under budget for the whole run.

### 2.2 Planning is a template selector, not a planner
**Prerequisite noted in Phase 1.1:** PLAN currently has no read capability at all (no tools are offered, and the state machine forbids `TOOL_CALLING` in PLAN). A planner that cannot inspect the repository is weak. When planning becomes a model call, PLAN must gain `read` (and `network`) so the planning turn can read files and search; the read-only contract still applies.

**Files:** `packages/planning-engine/src/planner.ts`, `orchestrator.ts`.
**Bug:** `analyzeTask()` is keyword matching that picks one of four hardcoded step templates. Every feature request in the entire product produces the identical three step plan with the identical title "Implement requested engineering changes". Worse, the plan is never shown to the model, and a step is marked COMPLETED whenever the model happens to return a turn with no tool calls. The plan is a UI animation, not a control structure.
**Fix:**
- Replace `analyzeTask` with a dedicated planning model call that emits structured steps with acceptance criteria.
- Validate the generated plan with the existing `PlanValidator`, which is genuinely good (dependency checks, Kahn cycle detection). Keep it.
- **Inject the current step and its acceptance criteria into the system prompt on every execution turn** so the plan actually steers the model.
- Complete a step only when its acceptance criteria are satisfied, not when tool calls happen to stop.
- Keep `PlanStateManager` and the repair plan mutation logic as is; they are well built.

### 2.3 Diagnosis only understands JavaScript and TypeScript
**File:** `packages/diagnostics-engine/src/evidence.ts`.
**Bug:** The evidence extractor regexes match only TypeScript compiler errors, Jest, Vitest, Mocha output and JS style stack frames. For Python, Go or Rust failures it finds no affected files, so repair scope validation has nothing to work with and the diagnose to repair loop silently degrades. Meanwhile `tools/validation` happily resolves pytest, mypy, go test and cargo, so verification is multi language while diagnosis is not.
**Fix:** Add parsers for pytest, mypy, go test, go vet, cargo and clippy output. Structure the extractor so a new language is a pluggable parser, not another regex in a pile.

### 2.4 Verification and validation disagree with each other
**Files:** `tools/validation/src/command_resolver.ts`, `tools/terminal/src/policy.ts`, `packages/verification-engine/src/verification_policy.ts`.
**Bugs:**
- The resolver emits `flake8`, `mypy` and `golangci-lint`, none of which are on the `CommandPolicy` allowlist, so they are denied at the policy layer.
- Java is detected by `ProjectDetector` but has no command mapping at all, so it is always UNAVAILABLE.
- `VerificationPolicy` decides requiredness using TypeScript file extension heuristics, so a Python only change often ends with every check optional and the completion gate passing trivially without verifying anything.
- Conversely, when a required check is UNAVAILABLE the task is reported FAILED even when the work is correct.
**Fix:** Align the allowlist with the resolver, map Java, make requiredness ecosystem aware, and distinguish "verification could not run" from "verification failed" in the completion gate so the user gets an honest status instead of a false failure.

### 2.5 Other engine issues worth fixing here
- **Sequential tool execution.** The orchestrator awaits tool calls one at a time in a `for` loop even when the model requests several independent read only calls. Execute read only calls in parallel.
- **Over eager hard failure.** When a mutating tool throws but the file changed, the orchestrator kills the whole task with `WORKSPACE_STATE_CHANGED_AFTER_TOOL_FAILURE`. Surface the error to the model for recovery instead, and reserve the hard fail for genuinely unverifiable states.
- **Double read per mutation.** Every write triggers a read before and a read after to compute hashes, doubling filesystem traffic and event noise. The tools already return hashes; use them.
- **Search does not scale.** `tools/search` is a hand rolled recursive Node scan with no ripgrep and no gitignore awareness. Add a ripgrep backend with a fallback.
- **Missing file operations.** There is no delete, move or rename tool, and everything assumes UTF 8 so binary files are mangled.
- **No durability.** The event store is in memory, capped at 5000, cleared five minutes after a task ends, and the execution cap is five minutes. There is no resume. Persist a task journal to disk and add checkpoint and resume.
- **No model routing.** `ModelRouter` is declared in `packages/model-core/src/index.ts` and never implemented. Retries hit the same provider only. Implement capability aware routing and cross provider fallback around the existing, excellent `ModelRequestManager`.

---

## PHASE 3 · Rebuild the interface as a dynamic application

This is the half the project owner cares most about. **Stop writing static HTML and manual DOM code.**

### What exists today and why it must go
- `apps/vscode-extension/src/webview/index.html` is 394 lines of hand written markup with every panel hardcoded.
- `main.js` is 2,184 lines of vanilla JavaScript doing `document.getElementById`, manual `innerHTML`, `addEventListener` wiring and hand rolled render functions for each of seven tabs.
- `style.css` is 3,145 lines with no component scoping.
- `chat_provider.ts` reads the HTML file from disk and string replaces `href="style.css"` and `src="main.js"` to inject URIs.
- There is a **"COMU Boot" diagnostic bar** with HTML, JS, DOM, Render, Host and Runtime probes shipped permanently in the production interface. Delete it or gate it behind a development flag.

This architecture cannot express the dynamic behaviour the product needs: streaming timelines, inline approval cards, live diffs, animated state transitions and virtualised lists.

### Target stack
Rebuild the webview as a proper application:

- **React 18 with TypeScript**, built by **Vite** into `dist/webview`. If you prefer Svelte for a smaller bundle and faster first paint, that is an acceptable substitute, but pick one and be consistent.
- **Typed state store** using Zustand or a reducer, fed by the existing SSE event stream. The event to state reduction currently living in `normalizeRawEvent` in `main.js` should become a pure, unit tested reducer.
- **Typed message protocol** shared between the extension host and the webview. `apps/vscode-extension/src/protocol/messages.ts` already has the shapes; make them the single source of truth on both sides.
- **Styling** with CSS Modules or Tailwind, but **all colours must map to VS Code theme variables** (`var(--vscode-*)`) so light, dark and high contrast themes all work. Never hardcode a hex colour for surface or text.
- **Proper CSP** with a generated nonce for the bundle, replacing the current string replacement approach and the overly permissive `connect-src http: https: ws:`.
- Keep `retainContextWhenHidden` and keep the fast first paint behaviour. Measure it; there is already a startup performance suite with 35 cases.

### Information architecture: fix the seven tab problem
Seven horizontal tabs with icon, label and badge do not fit a 300 to 400 pixel VS Code sidebar, and several of them (Workers, Memory) are empty most of the time. Restructure:

- **Activity becomes the persistent primary surface.** It is the signature view and should not compete for space.
- **The plan renders inline as a collapsible ribbon** above the stream, showing real model authored steps with live status, not a separate tab.
- **Changes stays a first class tab** because review is frequent.
- **Overview, Verification, Memory and Workers move into a details drawer** or a secondary row that appears only when it has content.
- The whole interface must work at narrow sidebar width **and** when opened as a full editor tab.

### New interface capabilities to build
1. **Inline approval cards.** When autonomy is `ask`, render a card inside the activity stream before a write or command, showing the diff preview or the exact command, with Approve, Approve for session, Edit and Deny. This consumes the Phase 1.2 work.
2. **Aggregate diff review.** A "review all changes" view listing every changed file with addition and deletion counts, a combined diff, and per file and ideally per hunk accept or reject. Today review is per file only, through the native VS Code diff, and always after the file is already written.
3. **Live progress and cost.** Header showing status, step k of n, elapsed time and cumulative token and cost estimates. The provider already returns usage in `ModelResponse.usage`; it is currently thrown away.
4. **Virtualised activity timeline.** Long tasks produce thousands of events. Virtualise the list and stream updates without a full redraw.
5. **Autonomy selector** in the composer next to mode and model.
6. **Task history.** Once Phase 2.5 durability lands, let the user reopen and continue previous tasks.
7. **Real feedback states.** Skeletons while loading, optimistic transitions, clear distinction between running, waiting for user, cancelling and failed. Errors must state what failed, why, and what the user can do.
8. **Keyboard and accessibility.** Shortcuts for tab switching, approve and deny, stop and focus of the composer. Real focus management. Labelled controls instead of emoji only buttons. The existing ARIA tablist is a decent start; go further.

### Migration rules
- Do this incrementally behind a feature flag if possible, and keep the extension working at every commit.
- Port the event normalisation logic first and cover it with tests, since it holds the real product knowledge.
- Do not regress the existing startup performance tests or the frontend UI tests.
- Delete `main.js`, `index.html` and `style.css` only once the replacement is at parity.

---

## Definition of done for this engagement

- A real task on a real repository runs in the **correct directory**, honours the **chosen mode**, and asks for **approval before writing** when autonomy is `ask`.
- A long task with many file reads and a full test run **completes without context overflow**.
- Plans are **authored by the model**, validated, and visibly steer execution step by step.
- A **Python repository** can be verified, diagnosed and repaired, not just a TypeScript one.
- The runtime is **bound to loopback and authenticated**.
- The interface is a **dynamic component application** with no hand written static HTML, no manual DOM manipulation, and no shipped debug bar.
- The **README makes no claim the code does not deliver.**

---

## How to start

1. Read `apps/agent-runtime/src/server.ts`, `packages/agent-core/src/orchestrator.ts`, `packages/agent-core/src/agent_kernel.ts` and `packages/planning-engine/src/planner.ts` in full. They contain most of the problems above.
2. Confirm each bug exists before fixing it, and tell me if the audit is wrong about any of them.
3. Propose a short ordered plan for Phase 0, then implement it one commit at a time with tests.
4. Report back after Phase 0 with what changed, what you verified, and what surprised you.

Ask me before making any architectural decision that is not specified here.
