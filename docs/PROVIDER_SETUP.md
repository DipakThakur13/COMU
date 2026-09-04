# COMU — Provider & API Key Setup Guide

COMU is a model-agnostic, **Bring Your Own Key (BYOK)** AI software engineering agent. 

COMU does **not** provide or resell AI inference subscriptions. You connect your own supported AI providers or local models directly from your development environment.

---

## 🛡️ Security & Secret Isolation Guarantees

- **Encrypted Local Storage**: API keys are saved exclusively in VS Code `SecretStorage` on your local device.
- **Zero Plaintext Exposure**: API keys are never rendered in the Webview DOM, streamed over SSE, written to task state, stored in persistent memory, or committed to Git.
- **Task-Start Guard**: If a selected model lacks configured credentials, COMU proactively blocks execution with a helpful warning and opens the Settings page.
- **Safe Testing**: Live connection tests use bounded timeouts and sanitized error responses without leaking credentials into logs.

---

## ⚡ Supported Providers

### 1. NVIDIA Nemotron (Cloud)

NVIDIA Nemotron models (including **Nemotron 3 Ultra**) provide high-performance reasoning and deterministic code refactoring.

#### Step 1: Obtain an NVIDIA API Key
1. Visit [NVIDIA Build](https://build.nvidia.com/) or the [NVIDIA NGC Console](https://org.ngc.nvidia.com/).
2. Create or sign in to your NVIDIA developer account.
3. Generate a personal API key (starts with `nvapi-...`).

#### Step 2: Configure in COMU
Choose one of the following methods:

**Method A: Directly in VS Code UI (Recommended)**
1. Open the COMU sidebar (`COMU: Open Chat`).
2. Click the **⚙ (Settings)** button in the header, or click **[ ⚙ Configure ]** next to the Model Selector.
3. Under the **NVIDIA** card:
   - Paste your API key into the **API Key** input.
   - (Optional) Adjust the Endpoint URL if using an enterprise proxy or custom endpoint (default: `https://integrate.api.nvidia.com/v1`).
   - Click **Save**.
4. Click **Test Connection** to verify your setup. A green checkmark with latency will confirm connectivity.

**Method B: Environment Variable**
1. Set the environment variable in your terminal before launching VS Code:
   ```bash
   export NVIDIA_API_KEY="nvapi-your-key-here"
   ```
2. COMU will automatically detect this environment variable. You can verify this by checking the `ℹ Detected in environment (NVIDIA_API_KEY)` badge in Provider Settings.

---

### 2. Ollama (Local Models)

Run open-weights models (e.g. Llama 3) locally on your own workstation with **zero external network requests**.

#### Setup:
1. Install [Ollama](https://ollama.ai/).
2. Pull your model:
   ```bash
   ollama run llama3
   ```
3. In COMU, select **Llama 3 (Local)** from the Model dropdown.
4. Ollama requires no API key. You can click **Test Connection** in Provider Settings to verify that Ollama is responding on `http://localhost:11434`.

---

### 3. OpenAI & Anthropic Compatible Providers

Connect custom endpoints or compatible API proxies:
1. Open Provider Settings in COMU.
2. Enter your API key and custom base URL.
3. Click **Save** and **Test Connection**.

---

## 🔍 Discoverability & VS Code Commands

You can access provider settings at any time using:
- **Header Icon**: Click ⚙ in the COMU Chat header.
- **Model Selector Link**: Click `⚙ Configure` next to the Model dropdown in the chat input area.
- **First-Run Onboarding**: When you open COMU for the first time, click **Connect NVIDIA Nemotron** directly from the chat view.
- **VS Code Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`):
  - `COMU: Open Provider Settings`
  - `COMU: Configure NVIDIA Provider`
  - `COMU: Test NVIDIA Connection`
