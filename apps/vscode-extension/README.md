# COMU AI Software Engineering Workspace for VS Code

<p align="center">
  <strong>Autonomous, Model-Agnostic AI Software Engineering Inside VS Code</strong>
</p>

<p align="center">

[![Version](https://img.shields.io/badge/Version-v0.2.2-blue.svg)](package.json)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC.svg)](https://code.visualstudio.com/)
[![Tests Passing](https://img.shields.io/badge/Tests-65%20Passed-brightgreen)](tests/)
[![BYOK](https://img.shields.io/badge/BYOK-Encrypted%20Storage-purple)](#-bring-your-own-key-byok-security)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

</p>

COMU is an open-source AI software engineering agent and workspace integrated directly into VS Code. It transforms the AI coding experience from a simple chatbot into a comprehensive software engineering control center that investigates codebases, creates structured implementation plans, modifies files with optimistic concurrency control, verifies builds and test suites, diagnoses failures, repairs bugs, and seeks human approval for critical actions.

---

## ⚡ Key Capabilities & Workspace Features

### 1. Phase 9 AI Engineering Workspace
- **Overview (`📊`)**: High-level KPI dashboard, active task summary, real-time duration ticker, and Completion Gate banner.
- **Plan (`📋`)**: Visual step-by-step checklist of the agent's architectural design with live progress indicators (`PENDING`, `ACTIVE`, `COMPLETED`, `FAILED`, `BLOCKED`).
- **Activity (`⚡`)**: The signature activity timeline grouping repetitive tool actions, rendering markdown with copyable code blocks, and streaming model thoughts.
- **Changes (`Δ`)**: Detailed ChangeSet review listing all added, modified, and deleted files with single-click triggers to open native VS Code side-by-side diff viewers.
- **Verification (`🛡️`)**: Matrix of automated test suites, linters, and typechecks with diagnostic failure summaries and self-repair attempts.
- **Memory (`🧠`)**: Project-specific conventions, architectural lessons, and verified memory cards.
- **Workers (`🤖`)**: Background subagent workers (Research Worker, Verification Worker) collaborating on multi-step workflows.

### 2. Collapsible Context Drawer (`🗂`)
- **Active Working Set**: Displays the current file in focus.
- **Recently Inspected Files**: Clickable chips to open any file inspected during research.
- **Modified Files**: Visual list of staged file mutations.
- **Diagnostics**: Real-time language server and compiler diagnostics.
- **Context Budget**: Live token estimation for model prompts.

### 3. Mode-Aware Composer
- **Auto (Classify)**: Automatically determines whether your request requires conversation, code investigation, architectural planning, or autonomous execution.
- **Agent (Autonomous)**: Multi-step autonomous coding, test execution, and self-repair.
- **Plan (Design)**: Comprehensive architectural planning without modifying files.
- **Ask (Investigate)**: Codebase exploration, semantic search, and technical Q&A.
- **Chat (Conversational)**: Direct conversational pair programming.

### 4. Instant Stop / Cancellation (`■ Stop`)
- **<5ms Responsive Cancellation**: Clicking Stop immediately switches the UI to `◌ Cancelling…`, disables further execution, and terminates the running task without freezing the editor.

### 5. High-Performance Startup & Non-Blocking Architecture
- **Instant First Paint (<20ms)**: The entire workspace shell, navigation, and composer render instantly from local safe defaults.
- **Zero-Blocking Lifecycle**: Never waits for runtime health checks, provider connection tests, or SSE connections before rendering.
- **40ms Streaming Throttling**: Batches rapid model tokens to maintain smooth 60fps scrolling and UI responsiveness.
- **Bounded Activity History**: Limits initial event rendering to 50 cards with an expandable "↑ Show earlier activities" control, preventing DOM bloat.

### 6. Bring Your Own Key (BYOK) Model Gateway
Connect directly to frontier AI models with your own API keys:
- **NVIDIA Nemotron (NVIDIA NIM)**: Nemotron 3.5 Lightning, DeepSeek V4 Pro, DeepSeek V4 Flash, Kimi K3, Laguna XS 2.1, Muse Glimmer 30B.
- **GPT-6 Astra (Experiential Labs)**: Frontier reasoning with up to **1,050,000 token** context window.
- **OpenAI-Compatible**: Connect any OpenAI-compatible API endpoint (GPT-4o, custom vLLM).
- **Ollama (Local & Offline)**: Run open-weights models (Llama 3, Qwen 2.5, DeepSeek) locally with **zero external telemetry**.

---

## 🚀 Getting Started

### 1. Installation
Install the VSIX package into VS Code:
```bash
code --install-extension comu-ai-0.2.1.vsix
```

### 2. Open COMU
Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) and run:
```
COMU: Open Chat
```
The COMU sidebar will appear in your primary sidebar. The embedded Agent Runtime server starts automatically in the background on port `3456`.

### 3. Connect Your Model Provider
1. Click the **⚙ Settings** button in the header (or click **⚙ Providers** in the composer controls bar).
2. Under your desired provider card, paste your API key:
   - **NVIDIA**: [build.nvidia.com](https://build.nvidia.com/)
   - **Experiential Labs (GPT-6 Astra)**: Experiential Labs gateway
   - **OpenAI**: Any OpenAI API key
   - **Ollama**: Default endpoint `http://localhost:11434`
3. Click **Test Connection** to verify latency and connectivity.

---

## 🛠️ Contributed Commands

| Command | Title | Description |
| :--- | :--- | :--- |
| `comu.openChat` | **COMU: Open Chat** | Opens the COMU AI engineering sidebar workspace |
| `comu.openProviderSettings` | **COMU: Open Provider Settings** | Opens the BYOK Provider configuration page |
| `comu.configureNvidia` | **COMU: Configure NVIDIA Provider** | Directly navigates to NVIDIA Nemotron settings |
| `comu.testProviderConnection` | **COMU: Test NVIDIA Connection** | Pings the NVIDIA endpoint and displays latency |

---

## ⚙️ Extension Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| `comu.runtime.baseUrl` | `http://localhost:3456` | URL of the COMU Agent Runtime server |
| `comu.defaultModel` | `nvidia/nemotron-3.5-lightning-30b-a3b` | Default model ID used for agent sessions |

---

## 🛡️ Security & Privacy Invariants

- **Zero Reselling of Inference**: COMU does not proxy or resell inference tokens. Your requests travel directly from your machine to your configured provider over TLS.
- **Hardware-Backed Secret Storage**: API keys are saved exclusively in VS Code `SecretStorage` (Windows DPAPI, macOS Keychain, Linux Secret Service).
- **Zero Secrets in Webview or DOM**: Keys are never exposed to the webview JavaScript runtime, HTML DOM, or telemetry logs.
- **Safe Concurrency (OCC)**: File operations use Optimistic Concurrency Control with atomic patches to safeguard your workspace against corruption.

---

## 🧪 Automated Testing

The extension includes a dedicated test suite with 100% pass rate:
- **`tests/startup_perf.test.ts`**: 35 performance and lifecycle tests (`PERF-01` through `PERF-35`).
- **`tests/frontend_ui.test.ts`**: 30 frontend architecture tests (`UI-01` through `UI-30`).

```bash
# Run extension unit tests
pnpm vitest run tests/startup_perf.test.ts tests/frontend_ui.test.ts
```

---

## 📜 License & Author

- **License**: MIT License
- **Author**: **Dipak Kumar**
- **Sponsor & Organization**: **[Boswas Group](https://www.boswas.co.in)**
- **Source Code**: [github.com/DipakThakur13/COMU](https://github.com/DipakThakur13/COMU)
