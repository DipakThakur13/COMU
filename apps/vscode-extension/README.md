# COMU — AI software engineering in VS Code

**Version 0.3.0 · Preview.** Model-agnostic, bring your own key, MIT licensed.

COMU is an AI coding agent that runs inside VS Code. It reads a codebase, plans a change, edits
files, runs the test suite, and asks before doing anything it cannot undo. You supply the model and
the API key; COMU never proxies or resells inference.

> **Read this before installing.** 0.3.0 is a preview. It has completed real tasks against a real
> model, and it has known defects that will affect you. They are listed under
> [Known limitations](#known-limitations), not buried. If you are looking for something dependable
> for daily work, this is not that yet.

---

## Security notice for anyone running 0.2.4 or earlier

**Uninstall it.** Versions up to and including 0.2.4 start a local HTTP server that binds every
network interface, allows every web origin, and requires no authentication. That server can create
tasks which read and write files and run shell commands. Any web page you visited while VS Code was
open could drive it, and on a shared or public network so could another machine.

0.3.0 fixes this with four independent controls, each verified against the packaged build:

| Control | Verified behaviour in 0.3.0 |
| :--- | :--- |
| Bound to loopback | Listens on `127.0.0.1` only, never `0.0.0.0` |
| Loopback guard | Any non-loopback peer is refused with `403`, even if the bind changed |
| Per-session token | No token or a wrong token gets `401`; the token is 256 random bits, new each session |
| CORS closed by default | Only `vscode-webview://` origins are allowed; any other origin receives no `Access-Control-Allow-Origin` header |

Upgrading does not disinfect anything that already happened. If you had 0.2.4 installed on an
untrusted network, treat the workspaces you opened as having been reachable.

---

## What works

These are exercised by the automated benchmark against NVIDIA Nemotron, graded by running the code
rather than by asking the agent whether it succeeded:

- **Single-file bug fixes.** Read the failing test, find the defect, fix it, confirm the suite is
  green. This is the most reliable thing COMU does.
- **Small feature additions and multi-file renames**, with mixed results — see the limitations.
- **Approval before irreversible actions.** File writes and commands stop for a human at the default
  `ask` autonomy. `git push` always asks, at every autonomy level, and cannot be pre-authorised.
- **Cancellation.** Stop aborts the run; every tool takes a required `AbortSignal` and a conformance
  suite asserts that each one refuses an aborted signal and writes nothing.
- **Python and TypeScript**, including repositories containing both.

## Known limitations

Honest list. Each is reproducible and each has a benchmark fixture.

- **A correct result can be reported as a failure in a polyglot repository.** COMU detects the
  project type from `package.json` before `pyproject.toml`. A Python project carrying a
  `package.json` for unrelated front-end tooling is treated as a Node project, the wrong toolchain
  runs, and verification fails **even though the change is correct and the tests pass**. Measured at
  5 out of 5 attempts on the fixture built for it. If you work in a mixed repository, expect COMU to
  tell you it failed when it did not.
- **Long read-only questions are cut short.** The repair budget is measured from the start of the
  task rather than from the start of repair, so a task older than three minutes can be terminated
  with `REPAIR_TIMEOUT` — including "explain this codebase" questions, where there is nothing to
  repair. Large repositories are the most affected.
- **Multi-file refactors are not dependable.** One observed run renamed a definition, correctly
  identified the five call sites, and then stopped without updating them, leaving the package
  unimportable. Review the diff before accepting.
- **The agent sometimes writes scratch files into your workspace**, such as an ad-hoc test script
  next to your source. Check the Changes tab.
- **Slow models can exhaust the default request timeout.** The default is two minutes per model
  request, which a large model on a large prompt can exceed.
- **`pnpm test` does not pass at the repository root.** Individual suites pass; the aggregate task
  does not. This is a known debt, recorded rather than hidden.
- **No published benchmark numbers yet.** A full baseline is being measured now. Nothing in this
  README quotes a success rate, because an honest one does not exist yet.

## Not verified

Stated plainly so you know what has and has not been checked:

- The packaging, the loopback binding, the token enforcement and the CORS policy in the table above
  were verified against **this exact packaged build**.
- An **end-to-end task driven from the VS Code interface** in this build has not been re-verified
  since packaging, because the benchmark was holding the model provider. The runtime, the approval
  gate and the tool layer are covered by automated tests; the interface path is not covered by this
  statement.

---

## Getting started

**1. Install**

```bash
code --install-extension comu-ai-0.3.0.vsix
```

**2. Open it.** `Ctrl+Shift+P` → `COMU: Open Chat`. The sidebar appears and the agent runtime
starts in the background on `127.0.0.1:3456`, authenticated with a token generated for that session.

**3. Add a key.** Click **⚙ Providers** and paste a key for one of:

| Provider | Where the key comes from |
| :--- | :--- |
| NVIDIA NIM | [build.nvidia.com](https://build.nvidia.com/) |
| OpenAI-compatible | Any OpenAI-compatible endpoint, including a local vLLM |
| Experiential Labs | Their gateway |
| Ollama | No key; a local daemon at `http://127.0.0.1:11434` |

Keys are stored in VS Code `SecretStorage` (Windows DPAPI, macOS Keychain, Linux Secret Service).
They are never written to the webview, the DOM, logs, or disk in plain text.

---

## Modes and autonomy

**Modes** — `Auto` picks one for you; `Agent` edits and runs commands; `Plan` designs without
touching files; `Ask` investigates read-only; `Chat` just talks.

**Autonomy** — `ask` (default) stops for approval before each write or command; `auto` runs without
stopping, except `git push`, which always asks; `readonly` never writes or executes, whatever the
mode says.

An approval shows the actual diff or the exact command. An approval that expires counts as a
denial, never as consent, and with nobody watching the panel the answer is no.

## Commands

| Command | What it does |
| :--- | :--- |
| `COMU: Open Chat` | Opens the sidebar |
| `COMU: Open Provider Settings` | BYOK provider configuration |
| `COMU: Configure NVIDIA Provider` | Jumps to the NVIDIA settings |
| `COMU: Test NVIDIA Connection` | Pings the endpoint and reports latency |

## Settings

| Setting | Default | Meaning |
| :--- | :--- | :--- |
| `comu.runtime.baseUrl` | `http://127.0.0.1:3456` | Where the runtime listens. Loopback only, token required. |
| `comu.defaultAutonomy` | `ask` | Autonomy preselected in the composer |
| `comu.defaultModel` | `nvidia-nemotron-3-ultra` | Model used when none is chosen |
| `comu.ollama.endpoint` | `http://127.0.0.1:11434` | Local Ollama daemon |

## Telemetry

None. COMU sends nothing anywhere except your prompts and code to the model provider you configure,
over TLS, directly from your machine. There is no analytics service, no crash reporter and no usage
collection. With Ollama, nothing leaves the machine at all.

---

## License and author

MIT. Built by **Dipak Kumar**, sponsored by **[Boswas Group](https://www.boswas.co.in)**.
Source: [github.com/DipakThakur13/COMU](https://github.com/DipakThakur13/COMU).
