# COMU — Open AI Software Engineering Workspace

<p align="center">
  <strong>COMU — Open-Source, Model-Agnostic AI Software Engineering Agent & Workspace for VS Code</strong>
</p>

<p align="center">
  <em>Understand your codebase. Plan architectural changes. Automate implementation. Verify results. Keep full control.</em>
</p>

<p align="center">

[![Version](https://img.shields.io/badge/Version-v0.2.0-blue.svg)](package.json)
[![Open Source](https://img.shields.io/badge/Open%20Source-Community%20Driven-brightgreen)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension%20v0.2.0-007ACC)](https://code.visualstudio.com/)
[![Tests Passing](https://img.shields.io/badge/Tests-311%20Passed%20(100%25)-brightgreen)](tests/)
[![Model Agnostic](https://img.shields.io/badge/AI-Model%20Agnostic%20%7C%20BYOK-purple)](#-bring-your-own-ai-provider-byok)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</p>

---

## 📌 Release & Specification Summary (v0.2.0)

| Component | Specification | Status |
| :--- | :--- | :--- |
| **Release Version** | `v0.2.0` | Production Hardened |
| **Interface Architecture** | **Phase 9 AI Engineering Workspace** | ✅ 7 Navigation Tabs + Context Drawer |
| **Startup Performance** | **Instant First Paint (<20ms)** | ✅ Non-blocking Async Hydration |
| **Model Gateway** | **Provider-Neutral Model Gateway** (`@comu/model-core`) | ✅ NVIDIA NIM, Experiential Labs (GPT-6 Astra), OpenAI, Ollama |
| **Frontier Context Support** | Up to **1,050,000 tokens** (GPT-6 Astra) | ✅ Context Engine & WorkingSet |
| **Monorepo Architecture** | 22 Modular Workspace Packages (`pnpm`) | ✅ 100% Passing Typecheck & Build |
| **Automated Test Suite** | **32 Test Files · 311 Tests Passing** | ✅ 100% Pass Rate (including `PERF-01` to `PERF-35`) |
| **VS Code Package** | `comu-ai-0.2.0.vsix` | Built & Ready to Install |

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

### 1. Phase 9 Engineering Workspace Interface
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
- **Mode-Aware Composer**:
  - **Auto**: Automatically classifies user intent into optimal mode.
  - **Agent**: Full autonomous multi-step execution, testing, and self-repair.
  - **Plan**: Generates comprehensive architectural designs and checklists without modifying code.
  - **Ask**: Fast codebase exploration, semantic search, and technical Q&A.
  - **Chat**: Conversational software engineering guidance.
- **First-Class Instant Cancellation (`■ Stop`)**:
  - Non-blocking, instant transition to `◌ Cancelling…` (<5ms response). Immediately stops agent execution without freezing the editor.

### 2. High-Performance Startup & Runtime Stabilization
- **Instant First Paint (<20ms)**: Renders the full workspace shell, navigation tabs, and composer immediately from local static defaults.
- **Zero-Blocking Architecture**: First paint **never** waits for runtime health checks, provider connection tests, secret decryption, model catalogs, or SSE handshakes.
- **Progressive Hydration**: Hydrates provider metadata, session history, and runtime status asynchronously in the background.
- **Streaming Render Throttling**: SSE token updates are batched into a 40ms queue, preventing UI freezing during heavy streaming.
- **Incremental Event Normalization**: Events are memoized in `normalizedEventsCache` by unique ID; large event histories (>50 items) are bounded with an expandable "↑ Show earlier activities" control.
- **CSS Layout Containment**: Uses `contain: layout style;` across scroll areas to eliminate layout thrashing during token streaming.
- **Component Error Boundaries**: Every tab is wrapped in an isolated error boundary, ensuring partial failures never blank the UI.

### 3. Provider-Neutral Model Gateway (BYOK)
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
  - Frontier reasoning and coding with up to **1,050,000 token** context window.
- **Generic OpenAI-Compatible Gateway**:
  - Connect any OpenAI-compatible API endpoint with your own API key (e.g. OpenAI `gpt-4o`, custom vLLM, OpenRouter).
- **Ollama (Local & Offline)**:
  - Run open-weights models (`llama3`, `deepseek-coder`, `qwen2.5-coder`) on your local machine with **zero external telemetry or network calls**.
- **Hardware-Backed Secret Storage**:
  - All API keys are encrypted in VS Code `SecretStorage` (Windows DPAPI, macOS Keychain, Linux Secret Service). Keys are never logged, exposed to the webview DOM, or committed to Git.

### 4. Autonomous Engineering Loop & Tools
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
code --install-extension apps/vscode-extension/comu-ai-0.2.0.vsix
```

### 2. Launch COMU
1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) and run:
   ```
   COMU: Open Chat
   ```
2. The COMU sidebar opens **instantly** (<20ms) in your primary sidebar.
3. The Agent Runtime backend starts automatically in the background.

### 3. Connect Your AI Provider (BYOK)
1. Click the **⚙ Settings** button in the COMU header.
2. Choose your provider:
   - **NVIDIA**: Paste your API key from [build.nvidia.com](https://build.nvidia.com/).
   - **Experiential Labs (GPT-6 Astra)**: Connect via your Experiential Labs endpoint.
   - **OpenAI**: Enter any OpenAI-compatible API key and endpoint.
   - **Ollama**: Connect to `http://localhost:11434` for 100% local, offline execution.
3. Click **Test Connection** to verify endpoint reachability and latency.

### 4. Build Software
Type your prompt in the Composer:
```text
Refactor the authentication middleware to use JWT tokens with automatic refresh, and add unit tests.
```
Select **Agent** mode and press **Enter**. Watch COMU plan, execute, verify, and present diffs in real-time.

---

## 🧪 Testing & Quality Assurance

COMU maintains a **100% automated test pass rate** across all packages:

```bash
# Run full monorepo test suite (32 test files, 311 tests)
pnpm vitest run

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

## 📜 License & Community

- **License**: [MIT License](LICENSE)
- **Author**: **Dipak Kumar**
- **Sponsor & Organization**: **[Boswas Group](https://www.boswas.co.in)**
- **Repository**: [github.com/DipakThakur13/COMU](https://github.com/DipakThakur13/COMU)

Contributions, issue reports, and feature suggestions are welcome!
