# COMU AI Software Engineering Agent for VS Code

<p align="center">
  <strong>Autonomous, Model-Agnostic AI Software Engineering Inside VS Code</strong>
</p>

COMU is an open-source AI software engineering agent that investigates codebases, creates structured implementation plans, modifies files with deterministic concurrency control, verifies builds & tests, diagnoses failures, repairs bugs, and seeks human approval for critical actions.

---

## ⚡ Key Capabilities

- **Bring Your Own Key (BYOK)**: Connect your own provider credentials directly in VS Code. First-class support for **NVIDIA Nemotron 3 Ultra** and local offline models via **Ollama**.
- **Autonomous Engineering Orchestration**: Executes multi-step development loops (Plan → Execute → Verify → Diagnose → Repair).
- **Interactive Implementation Plans**: Live progress tracking across plan steps with real-time SSE event streaming.
- **Automated Verification Engine**: Automatically runs linters, typechecks, build commands, and test suites to validate edits before completion.
- **Failure Diagnosis & Self-Repair**: Pinpoints root causes and performs bounded self-repair cycles when tests or builds fail.
- **Controlled Git Governance**: Human-in-the-loop interactive approval cards for staging, commits, and remote pushes.
- **Encrypted Local Storage**: API keys are saved exclusively in VS Code `SecretStorage` and never exposed or committed to Git.

---

## 🚀 Getting Started

### 1. Instant 1-Click Launch (Auto-Starting Backend)
The COMU extension automatically launches and manages the local Agent Runtime backend process in the background. No manual terminal commands are needed to get started!

### 2. Connect Your AI Provider (BYOK)
1. Open the COMU Sidebar in VS Code (`Ctrl+Shift+P` → `COMU: Open Chat`).
2. Click the **⚙ Settings** button in the header (or click **Connect NVIDIA Nemotron** on the onboarding card).
3. Under the **NVIDIA** card, paste your NVIDIA API Key (from [build.nvidia.com](https://build.nvidia.com/)).
4. Click **Save** and **Test Connection** to verify connectivity with latency reporting.
*(Alternatively, select **Ollama (Local)** to run models completely offline with zero network calls).*

*(Optional for developers)*: If you want to run a custom development runtime server on port `3456`, COMU will automatically detect and connect to your existing instance instead of starting a new process.

---

## 🛠️ Contributed Commands

| Command | Title | Description |
| :--- | :--- | :--- |
| `comu.openChat` | **COMU: Open Chat** | Opens the COMU AI engineering sidebar |
| `comu.openProviderSettings` | **COMU: Open Provider Settings** | Opens the BYOK Provider configuration page |
| `comu.configureNvidia` | **COMU: Configure NVIDIA Provider** | Directly jumps to NVIDIA Nemotron setup |
| `comu.testProviderConnection` | **COMU: Test NVIDIA Connection** | Pings the NVIDIA endpoint and displays latency |

---

## ⚙️ Extension Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| `comu.runtime.baseUrl` | `http://localhost:3456` | URL of the COMU Agent Runtime server |
| `comu.defaultModel` | `nvidia-nemotron-3-ultra` | Default model ID used for agent sessions |

---

## 🛡️ Security & Privacy

- **No Key Reselling**: COMU does not provide or resell inference credits. You connect directly to your provider accounts.
- **Local Secret Storage**: Keys are stored in VS Code's encrypted keychain (`SecretStorage`).
- **Workspace Concurrency**: File edits utilize Optimistic Concurrency Control (OCC) and diff engines to protect your local workspace from corruption.

---

## 📜 License & Community

- **License**: MIT License
- **Author**: **Dipak Kumar**
- **Company / Organization**: **[Boswas Group](https://www.boswas.co.in)**
- **Open Source**: This project is 100% open source and open for everyone to contribute.
- **Source Code**: [github.com/DipakThakur13/COMU](https://github.com/DipakThakur13/COMU)
