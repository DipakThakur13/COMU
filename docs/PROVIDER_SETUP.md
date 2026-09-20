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

Run open-weights models locally on your own workstation with **zero external network requests**. COMU talks to Ollama's OpenAI-compatible endpoint (`/v1/chat/completions`) and discovers installed models through `/api/tags`.

#### Setup:
1. Install [Ollama](https://ollama.com/) and make sure the daemon is running (`ollama serve`).
2. Pull a model that supports tool calling, for example:
   ```bash
   ollama pull llama3.1
   ollama pull qwen2.5-coder
   ```
3. In COMU, open the Model dropdown. Every installed model appears as `<name> (Local)` (model ids are `ollama:<name>`, e.g. `ollama:qwen2.5-coder:7b`).
4. Ollama requires no API key and none is sent. **Test Connection** in Provider Settings probes the daemon and reports the installed models.
5. The daemon address defaults to `http://127.0.0.1:11434`. Override it with the `comu.ollama.endpoint` setting or the `OLLAMA_HOST` environment variable.

If the daemon is not reachable, COMU refuses to start the task and says so; it never falls back to a cloud provider for a local model.

---

### 2b. GPT-6 Astra (Experiential Labs)

An OpenAI-compatible gateway. Base URL `https://api.experientiallabs.ai/v1`, model id `gpt-6-astra`,
authenticated with an Experiential Labs API key.

Verified reachable on 2026-09-20: the host resolves and the API answers `401` without a key, which
is what a real key-gated endpoint should do. COMU previously shipped `https://api.experiential.com/v1`,
which does not resolve at all, so the entry would have sat in `NOT_CONFIGURED` and then failed with
a network error for anyone who added a key. That endpoint is corrected.

COMU shows token counts for this model but no cost estimate. The listed price is promotional, and
COMU does not present a promotional rate as a fact.

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
