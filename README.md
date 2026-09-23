# COMU — Open AI Software Engineering Workspace

<p align="center">
  <strong>COMU — Open-Source, Model-Agnostic AI Software Engineering Agent & Workspace for VS Code</strong>
</p>

<p align="center">
  <em>Understand your codebase. Plan architectural changes. Automate implementation. Verify results. Keep full control.</em>
</p>

<p align="center">

[![Version](https://img.shields.io/badge/Version-v0.3.1%20preview-orange.svg)](package.json)
[![Open Source](https://img.shields.io/badge/Open%20Source-Community%20Driven-brightgreen)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension%20v0.3.1-007ACC)](https://code.visualstudio.com/)
[![Tests](https://img.shields.io/badge/tests-832%20passing-brightgreen)](vitest.config.ts)
[![Model Agnostic](https://img.shields.io/badge/AI-Model%20Agnostic%20%7C%20BYOK-purple)](#-bring-your-own-ai-provider-byok)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</p>

---

> ### ⚠️ If you have COMU 0.2.4 or earlier installed, uninstall it
>
> Those versions start a local HTTP server with `app.use(cors())` and `app.listen(3456)` — every
> network interface, every web origin, no authentication — and that server creates tasks that read
> files, write files and run shell commands. Any web page open in a browser could drive it. 0.3.1
> closes this with four independent controls, verified against the packaged build. Upgrading does
> not undo prior exposure.

---

## 📌 Release summary (v0.3.1, preview)

| Component | Specification | Status |
| :--- | :--- | :--- |
| **Release version** | `v0.3.1` | **Preview.** Completes real tasks; has known defects, listed below |
| **Interface** | React 18 + Vite panel (`apps/webview`) | The only interface; the legacy webview is removed |
| **Model gateway** | Provider-neutral (`@comu/model-core`) | NVIDIA NIM, Experiential Labs, OpenAI-compatible, Ollama (local, keyless) |
| **Runtime boundary** | Loopback bind, loopback guard, per-session token, closed CORS | Verified against the packaged 0.3.0 build; unchanged in 0.3.1 |
| **Monorepo** | 24 workspace packages (`pnpm`) | Typecheck, lint and build pass |
| **Unit and integration tests** | 820 tests across 66 files (`vitest`) | Passing |
| **VS Code integration tests** | 12 tests, real VS Code 1.138 | Passing. `pnpm test` runs the whole aggregate and exits 0 |
| **Benchmark baseline** | 15 fixtures × 5 repetitions, graded by running the code | **In progress.** No success rate is published yet |
| **Visual regression** | 144 baselines, 3 themes x 3 widths | Passing at zero changed pixels |

### Known defects in 0.3.1

Reproducible, each with a benchmark fixture, none of them hidden:

- **A correct change can be reported as a failure in a polyglot repository.** Project type is
  detected from `package.json` before `pyproject.toml`, so a Python project carrying a
  `package.json` for front-end tooling is verified with the wrong toolchain. Observed on 5 of 5
  attempts against the fixture built for it.
- **The repair budget is measured from the start of the task, not the start of repair**, so a task
  running longer than three minutes can be killed with `REPAIR_TIMEOUT` — including read-only
  questions, where there is nothing to repair.
- **Multi-file refactors are unreliable**: one run renamed a definition, named the five call sites
  it needed to update, and stopped without updating them.

---

## 🏢 Organization & Author

COMU is created by **Dipak Kumar** and sponsored by **[Boswas Group](https://www.boswas.co.in)**.  
It is **100% open-source software** under the permissive **MIT License**, open for developers worldwide to use, inspect, fork, and contribute.

---

## 🌟 The Vision: Beyond Chatbots

Current AI coding assistants treat AI as a simple chatbot in a side panel. When an autonomous coding task runs, developers are left asking:
- *What is the AI actually doing right now?*
- *What files did it read or inspect?*
- *What lines of code were modified?*
- *Did it actually run tests, or did it just claim it did?*
- *How can I stop it immediately if it goes off track?*

**COMU transforms the AI coding experience from a chatbot into a state-of-the-art AI Software Engineering Workspace.**

COMU is engineered to answer the **6 Fundamental Engineering Questions** in real-time:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       COMU ENGINEERING WORKSPACE                            │
├──────────────────────────────────────┬──────────────────────────────────────┤
│ 1. What is COMU doing?               │ Signature Activity Timeline & State  │
│ 2. What did COMU find?               │ WorkingSet, Context Drawer & Workers │
│ 3. What changed?                     │ ChangeSet review with native VS Diff │
│ 4. What is COMU verifying?           │ Automated Verification Matrix        │
│ 5. Does COMU need the user?          │ Interactive Human-in-the-Loop Cards  │
│ 6. Why is the task complete/failed?  │ Completion Gate & Root Diagnosis     │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

---

## ⚡ Core Features & Capabilities

### 1. The Engineering Workspace Interface
- **Workspace Navigation Tabs**:
  - **Overview (`📊`)**: High-level task KPI dashboard, execution duration ticker, plan completion summary, and Completion Gate banner.
  - **Plan (`📋`)**: Live checklist of structured plan steps with real-time status badges (`PENDING`, `ACTIVE`, `COMPLETED`, `FAILED`, `BLOCKED`).
  - **Activity (`⚡`)**: The signature activity timeline displaying user messages, tool executions, terminal commands, verification runs, and expandable inline details.
  - **Changes (`Δ`)**: Complete ChangeSet breakdown showing created and modified files with single-click native VS Code side-by-side diff viewers.
  - **Verification (`🛡️`)**: Detailed matrix of automated test runs, linters, typechecks, diagnostics, and self-repair attempts.
  - **Memory (`🧠`)**: Workspace conventions, lessons learned, and verified project patterns.
  - **Workers (`🤖`)**: Active subagents (Research Worker, Verification Worker) collaborating on multi-step workflows.
- **Context Drawer (`🗂`)**:
  - Displays the active working set: current active file, recently inspected files, modified files, active diagnostics, and token context estimates.
- **Mode-Aware Composer** (the selected mode travels with the task request and is honoured as-is; only **Auto** classifies):
  - **Auto**: Classifies intent with a deterministic fast path (politeness prefixes ignored), falls back to a cheap model classification when the rules cannot decide, and only asks a clarification question (as an inline input card) when the model is genuinely uncertain.
  - **Agent**: Full autonomous multi-step execution, testing, and self-repair.
  - **Plan**: Generates comprehensive architectural designs and checklists without modifying code (no tools are offered or executable in Plan).
  - **Ask**: Fast codebase exploration, semantic search, and technical Q&A. Read-only by contract: mutating and command tools are neither offered to the model nor executable if it names one anyway.
  - **Chat**: Conversational software engineering guidance.
- **First-Class Cancellation (`■ Stop`)**:
  - Non-blocking transition to `◌ Cancelling…`, then the run stops without freezing the editor.
    Cancellation is a required `AbortSignal` on every tool, and a conformance suite over the whole
    registry asserts that each tool refuses an aborted signal and writes nothing.

### 2. Interface
The panel is a React 18 + TypeScript application (`apps/webview`) built by Vite, with a Zustand store fed by a pure, unit-tested event reducer (`@comu/ui-state`) shared with the extension host. It is the only interface: the previous hand-written panel has been removed, and the `comu.ui.experimental` setting that used to select between them has been removed with it.

- **Token-level streaming**: the assistant's reply renders as it is generated (`model.token_delta`), with worker turns kept on their own channel so they never interleave into the main stream.
- **Live cost and usage**: tokens and, where the model has a published price, spend, both of which the runtime previously computed and discarded. A model with no published price shows tokens only rather than an invented figure.
- **Virtualised activity timeline**: thousands of events render a bounded number of rows; earlier activity beyond the runtime's own 5000-event ceiling is elided with an explicit affordance rather than lost silently.
- **Every colour resolves from a VS Code theme variable**, enforced by a test, so light, dark and high contrast are all correct. Icons are inline Codicons drawing with `currentColor`; no emoji.
- **Strict CSP**: the host document is generated in TypeScript with a per-load nonce, so `script-src` needs no `unsafe-inline` and `connect-src` is gone entirely.
- **Standalone harness** at `http://127.0.0.1:3000` replaying recorded fixtures in any theme at any panel width, so the interface can be built without reloading an extension host.
- **Approval card** showing the actual diff, the exact argument vector for a command, and separately labelled grant scopes, with a countdown that states in words that expiry means denial.
- **Plan ribbon and read-only change review**, the latter deliberately without an accept or revert control, because the engine has no revert and a button that does nothing is worse than none.
- **Drawer surfaces** for the task overview, verification checks, background workers, workspace memory and the working set, each appearing only when it has content.
- **Visual regression** over every fixture in three themes at three panel widths, with committed baselines, which is the only check that can see a colour that ignores the theme or a control that overflows a 280px sidebar.

### 3. Startup & Runtime Stabilization

The startup suite (`PERF-01` to `PERF-35`) asserts budgets on the operations below; the figures it
enforces are 100ms for the bounded initial render path and 50ms for event normalisation. Wall-clock
first-paint and cancellation latency are **not** measured, so no number is quoted for them here.

- **First paint from local defaults**: Renders the workspace shell, navigation tabs, and composer from local static defaults rather than waiting on I/O.
- **Zero-Blocking Architecture**: First paint **never** waits for runtime health checks, provider connection tests, secret decryption, model catalogs, or SSE handshakes.
- **Progressive Hydration**: Hydrates provider metadata, session history, and runtime status asynchronously in the background.
- **Streaming Render Throttling**: SSE token updates are batched into a 40ms queue, preventing UI freezing during heavy streaming.
- **Incremental Event Normalization**: Events are memoized in `normalizedEventsCache` by unique ID; large event histories (>50 items) are bounded with an expandable "↑ Show earlier activities" control.
- **CSS Layout Containment**: Uses `contain: layout style;` across scroll areas to eliminate layout thrashing during token streaming.
- **Component Error Boundaries**: Every tab is wrapped in an isolated error boundary, ensuring partial failures never blank the UI.

### 4. Provider-Neutral Model Gateway (BYOK)
Bring Your Own Key directly to VS Code. COMU does not resell inference credits or lock you into a proprietary model:
- **NVIDIA Nemotron (NVIDIA NIM)**:
  - `Nemotron 3.5 Lightning 30B-A3B` (Fast Agent)
  - `DeepSeek V4 Pro 0813` (Deep Engineering)
  - `DeepSeek V4 Flash 0731` (Fast Agent + Chat)
  - `Moonshot Kimi K3` (Frontier Coding)
  - `Poolside Laguna XS 2.1` (Long-Horizon Coding)
  - `Meta Muse Glimmer 30B` (Multimodal Specialist)
  - `Nemotron 3 Ultra` (High Compute)
- **GPT-6 Astra via Experiential Labs Gateway**:
  - Frontier reasoning and coding with up to a **1,050,000 token** context window, through `https://api.experientiallabs.ai/v1`. COMU reports token counts but no cost for this model: the listed price is promotional, and a promotional rate is not something to bake in and present as fact.
- **Generic OpenAI-Compatible Gateway**:
  - Connect any OpenAI-compatible API endpoint with your own API key (e.g. OpenAI `gpt-4o`, custom vLLM, OpenRouter).
- **Ollama (Local & Offline)**:
  - Run any model you have pulled (`llama3.1`, `qwen2.5-coder`, `deepseek-coder-v2`, ...) through Ollama's OpenAI-compatible endpoint. No API key is sent, inference never leaves your machine, and COMU lists the models actually installed on the daemon. Reachability is probed for real; an unreachable daemon is reported instead of silently falling back to a cloud provider.
- **Hardware-Backed Secret Storage**:
  - All API keys are encrypted in VS Code `SecretStorage` (Windows DPAPI, macOS Keychain, Linux Secret Service). Keys are never logged, exposed to the webview DOM, or committed to Git.

### 5. Autonomous Engineering Loop & Tools
- **AgentKernel FSM**: Formal finite state machine governing state transitions:
  `IDLE` → `STARTING` → `CLASSIFYING` → `ANALYZING` → `PLANNING` → `THINKING` → `TOOL_CALLING` → `OBSERVING` → `VERIFYING` → `DIAGNOSING` → `REPAIRING` → `WAITING_FOR_USER` → `COMPLETED` / `FAILED` / `CANCELLED`.
- **15+ Built-In Engineering Tools**:
  - `read_file`, `edit_file`, `write_file`, `patch_file`, `create_file`
  - `search_code`, `find_files`, `grep_search`
  - `execute_command` (terminal execution with strict safety policies)
  - `git_status`, `git_diff`, `git_commit`, `git_push`
  - `run_tests`, `run_linter`, `run_typecheck`
  - `fetch_web_docs`
- **Workspace Concurrency & Safety (OCC)**:
  - Optimistic Concurrency Control ensures atomic file edits and prevents workspace corruption.
- **Automated Verification & Self-Repair**:
  - Automatically runs test suites and linters after code modifications.
  - When tests fail, COMU performs root cause diagnosis and initiates bounded self-repair cycles.
- **Human-in-the-Loop Git Governance**:
  - Proposes structured Git commit messages and requires interactive user approval before committing or pushing to remotes.
- **Autonomy Levels & Approval Cards**:
  - Choose **Ask before changes** (default), **Auto** or **Read-only** in the composer (default via `comu.defaultAutonomy`). In *Ask*, every file write, edit and command pauses the task at `WAITING_FOR_USER` and renders an inline approval card carrying the **proposed unified diff** (computed before anything is written) or the **exact command argument vector and working directory** (never a shell string). Approve once, approve with an explicit scope for the session (this file, this directory, all writes; for commands the exact normalised command), or deny. A denial is returned to the model as a tool error so it can adapt; it does not fail the task. Waiting for a human does not count against the execution time budget. With no COMU panel attached, or after a bounded wait, the answer is a denial, never an implicit approval. Every decision is journaled as an `approval.decided` event with its scope key. *Edit before approve* is not yet available.
- **Locked-Down Local Runtime**:
  - The agent runtime binds to `127.0.0.1` only, requires a random per-session bearer token on every route (constant-time checked), and scopes CORS to VS Code webview origins. Every task carries the workspace root it may operate on; the runtime never falls back to its own working directory.

---

## 🏗️ Architecture & Monorepo Structure

```
d:\COMU/
├── apps/
│   ├── vscode-extension/         # VS Code Extension (Presentation, Webview, BYOK Manager)
│   └── agent-runtime/            # Standalone / Embedded Node.js Agent Runtime Server
├── packages/
│   ├── agent-core/               # AgentKernel, Orchestrator, Subagents, State Machine
│   ├── context-engine/           # Context compilation, WorkingSet tracker, Token budgeting
│   ├── diagnostics-engine/       # Error capture, diagnostics aggregation, compiler feedback
│   ├── diff-engine/              # Safe file patching, diff computation, AST patching
│   ├── memory-engine/            # Workspace memory, conventions, lesson learned store
│   ├── model-core/               # Provider-neutral model gateway, OpenAI/Astra protocol
│   ├── planning-engine/          # Structured plan generator, dependency resolver
│   ├── protocol/                 # Shared schemas, RPC messages, event definitions
│   ├── repair-engine/            # Root cause analysis, diagnosis, repair loop
│   ├── shared/                   # Shared utilities, filesystem helpers, logger
│   ├── tool-core/                # Tool execution engine, canonical parser, permissions
│   └── verification-engine/      # Test runners, verification campaign, completion gate
├── providers/
│   └── nvidia/                   # NVIDIA NIM provider implementation
└── tools/
    ├── filesystem/               # File read/write/edit/search tools
    ├── git/                      # Git status, diff, commit, push tools
    ├── search/                   # Code search & ripgrep integration
    ├── terminal/                 # Terminal command execution & sandboxing
    ├── validation/               # Test runner & linter integration
    └── web-docs/                 # Technical documentation fetcher
```

---

## 🚀 Quick Start Guide

### 1. Install the VS Code Extension
Install the packaged extension directly into VS Code:
```bash
code --install-extension apps/vscode-extension/comu-ai-0.3.1.vsix
```

### 2. Launch COMU
1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) and run:
   ```
   COMU: Open Chat
   ```
2. The COMU sidebar opens in your primary sidebar, rendering from local defaults rather than
   waiting on the runtime.
3. The Agent Runtime starts in the background on `127.0.0.1:3456`, authenticated with a token
   generated for that session.

### 3. Connect Your AI Provider (BYOK)
1. Click the **⚙ Settings** button in the COMU header.
2. Choose your provider:
   - **NVIDIA**: Paste your API key from [build.nvidia.com](https://build.nvidia.com/).
   - **Experiential Labs (GPT-6 Astra)**: Connect via your Experiential Labs endpoint.
   - **OpenAI**: Enter any OpenAI-compatible API key and endpoint.
   - **Ollama**: Start `ollama serve`, pull a model, and pick it from the Model dropdown. The default daemon address is `http://127.0.0.1:11434` (override with the `comu.ollama.endpoint` setting or `OLLAMA_HOST`).
3. Click **Test Connection** to verify endpoint reachability and latency.

### 4. Build Software
Type your prompt in the Composer:
```text
Refactor the authentication middleware to use JWT tokens with automatic refresh, and add unit tests.
```
Select **Agent** mode and press **Enter**. Watch COMU plan, execute, verify, and present diffs in real-time.

---

## 🧪 Testing & Quality Assurance

Everything passes, including the VS Code integration suite, which 0.3.0 reported as failing. That
report was wrong: the launcher was being run from inside a VS Code extension host, whose
environment sets `ELECTRON_RUN_AS_NODE=1`. That variable makes `Code.exe` behave as plain Node,
which then rejects every VS Code flag it is given ("bad option: --skip-welcome"). From an ordinary
terminal the same command launches VS Code and the suite passes. The aggregate task was failing for
a second, unrelated reason: `@comu/benchmark` ran `vitest` from its own directory, where the root
config's exclusion of `fixtures/**` did not apply, so it collected twenty-six pinned sample
repositories whose tests are meant to fail.

```bash
# Unit and integration suites: 820 tests across 66 files, all passing
pnpm vitest run

# Everything, including 12 VS Code integration tests in real VS Code 1.138. Exits 0.
# Run it from a normal terminal, not from an extension host's shell.
pnpm test

# The panel's visual baselines: 144 screenshots, zero changed pixels allowed
pnpm --filter @comu/webview test:visual

# Run TypeScript typechecks across all 21 packages
pnpm typecheck

# Build all packages and the VS Code extension
pnpm build

# Package the VS Code extension
cd apps/vscode-extension && npx @vscode/vsce package --no-dependencies
```

### Test Suite Highlights:
- **`tests/startup_perf.test.ts`**: Verifies `PERF-01` through `PERF-35` (Instant paint, async hydration, 1000-event bounding, instant cancellation, zero secret leaks).
- **`tests/frontend_ui.test.ts`**: Verifies `UI-01` through `UI-30` (Interaction modes, timeline grouping, diff triggers, verification gate, BYOK storage).
- **`apps/agent-runtime/tests/`**: Full end-to-end multi-step agent orchestration, test repair campaigns, and OCC file mutation tests.

---

### Toolchain notes
- `package.json` pins `confbox` to `0.1.8` through `pnpm.overrides`. `confbox@0.1.9` (a transitive dependency of `vitest` via `local-pkg` → `pkg-types`) was unpublished from npm on 2026-09-03 while still recorded in the lockfile, which made every dependency re-resolution fail. `0.1.8` is the last published `0.1.x` release and satisfies `pkg-types`' range. Remove the override once `vitest` (or `pkg-types`) moves to a range that no longer resolves to the unpublished version, then run `pnpm install` and confirm the lockfile no longer mentions `0.1.9`.

## 📜 License & Community

- **License**: [MIT License](LICENSE)
- **Author**: **Dipak Kumar**
- **Sponsor & Organization**: **[Boswas Group](https://www.boswas.co.in)**
- **Repository**: [github.com/DipakThakur13/COMU](https://github.com/DipakThakur13/COMU)

Contributions, issue reports, and feature suggestions are welcome!
