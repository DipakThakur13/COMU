# COMU

<p align="center">
  <strong>COMU — Open AI Software Engineering Agent</strong>
</p>

<p align="center">
  <em>Build with AI. Understand your code. Automate the work. Keep control.</em>
</p>

<p align="center">

[![Open Source](https://img.shields.io/badge/Open%20Source-Community%20Driven-brightgreen)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007ACC)](https://code.visualstudio.com/)
[![Model Agnostic](https://img.shields.io/badge/AI-Model%20Agnostic-purple)](#models--providers)
[![Contributions Welcome](https://img.shields.io/badge/Contributions-Welcome-orange)](#contributing)

</p>

---

## 🌍 The Vision

**COMU is an open-source AI software engineering agent built for everyone.**

The goal is bigger than adding an AI chat box to an editor.

COMU is being built as an **open, extensible engineering platform** that can understand a codebase, investigate problems, plan changes, modify code, run development workflows, validate results, diagnose failures, repair problems, and work with the developer throughout the process.

It is designed to be:

- **Open** — the community can inspect, fork, modify, and improve it.
- **Model-agnostic** — no single AI model defines the project.
- **Local-first** — the core runtime can run on the developer's own machine.
- **Extensible** — tools, providers, planning strategies, validation systems, and UI components can evolve independently.
- **Safety-conscious** — the model proposes intent, while COMU controls what the agent is actually allowed to do.
- **Community-driven** — improvements from developers everywhere should make the agent better for everyone.

> **COMU is not trying to be another closed AI coding assistant.  
> COMU is trying to become an open foundation for AI-powered software engineering.**

---

# 🚀 What Is COMU?

COMU is an AI coding agent that sits between your **AI model** and your **development environment**.

Instead of treating an AI model as an unrestricted operator, COMU gives the model controlled capabilities through a runtime and tool system.

A typical workflow looks like:

```text
Developer
    │
    ▼
┌─────────────────────────────┐
│         COMU UI             │
│       VS Code / Webview     │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│      Agent Runtime          │
│  Orchestration + State      │
└──────────────┬──────────────┘
               │
      ┌────────┴────────┐
      ▼                 ▼
  Planning           Tooling
      │                 │
      ▼                 ▼
Verification      Workspace / Git
Diagnosis         Terminal / Tests
Repair            Validation
      │                 │
      └────────┬────────┘
               ▼
       Model Provider
               │
               ▼
       AI / Local Model
```

The model is replaceable.

The tools are replaceable.

The UI is replaceable.

The orchestration can evolve.

That is the point.

---

# 🧠 COMU's Core Principle

## The model controls intent. COMU controls authority.

An AI model may decide:

> "I need to inspect this file."

or:

> "I need to run the project's tests."

or:

> "I need to modify this function."

But the model does **not** independently decide what the host machine allows.

COMU evaluates the requested operation through its own tool, workspace, execution, and policy layers.

```text
Model
  ↓
Intent
  ↓
Canonical Tool Call
  ↓
COMU Validation / Policy
  ↓
Tool Executor
  ↓
Controlled Capability
  ↓
Bounded Result
  ↓
Model
```

This separation is one of the most important architectural ideas in COMU.

---

# ✨ What COMU Can Do

## 📁 Understand the workspace

COMU can build bounded context from the development environment instead of blindly sending an entire repository to the model.

Capabilities include:

- File reading.
- Directory inspection.
- Workspace tree discovery.
- Text search.
- Active editor context.
- Open-file context.
- Selection context.
- Workspace-root validation.
- Multi-root workspace awareness.
- Bounded context compilation.

The goal is to give the model the **right context**, not simply the **maximum context**.

---

## ✍️ Modify code safely

COMU provides controlled code modification tools such as:

- `create_file`
- `write_file`
- `edit_file`

The modification layer is designed around predictable changes.

Important protections include:

- Exact-match editing.
- Rejecting ambiguous replacements.
- Expected-file-hash checks.
- Optimistic concurrency control.
- ChangeSet tracking.
- Baseline capture.
- Unified diffs.
- Native VS Code diff review.

A coding task therefore becomes observable:

```text
Before
  ↓
Agent Change
  ↓
Diff
  ↓
Validation
  ↓
Final State
```

---

## 🖥️ Work with the terminal — without giving away the machine

COMU uses a controlled command execution pipeline rather than handing the model an unrestricted shell.

```text
Model
  ↓
CommandPlan
  ↓
CommandPolicy
  ↓
ToolExecutor
  ↓
ProcessManager
  ↓
Controlled Process
  ↓
Sanitized / Bounded Output
  ↓
Agent
```

The execution system is designed to enforce controls around:

- Executable + argument structure.
- Working directory boundaries.
- Command classification.
- Allow / deny policies.
- Environment sanitization.
- Output limits.
- Output redaction.
- Timeouts.
- Cancellation.
- Process-tree cleanup.

The principle remains:

> **The model can request an operation. The runtime decides whether that operation is permitted.**

---

## 🧪 Validate real results

COMU is designed to avoid a common failure mode of AI coding tools:

> "The model says the fix works, so it must work."

Instead:

```text
Change
  ↓
Test / Build / Lint / Typecheck
  ↓
Evidence
  ↓
PASS ───────────────► Continue
  │
  └── FAIL
        ↓
     Diagnose
        ↓
      Repair
        ↓
   Re-validate
```

Supported validation directions include:

- Tests.
- Builds.
- Linters.
- Type checking.
- Git state.
- ChangeSet verification.

The long-term goal is **evidence-based completion**.

---

## 🔍 Diagnose failures

A failed command should not automatically become a generic:

> "Something went wrong."

COMU is being designed to turn validation evidence into structured diagnosis.

Potential failure categories include:

```text
TYPE_ERROR
TEST_FAILURE
BUILD_FAILURE
LINT_FAILURE
RUNTIME_ERROR
COMMAND_FAILURE
TIMEOUT
CONFIGURATION_ERROR
DEPENDENCY_ERROR
UNKNOWN
```

Diagnosis can consider:

- Exit codes.
- stdout / stderr.
- Stack traces.
- Failed test names.
- Diagnostics.
- Affected files.
- Recent changes.
- Git diff.
- Validation history.

The objective is to move from:

```text
Failure
```

to:

```text
Failure
  ↓
Evidence
  ↓
Diagnosis
  ↓
Targeted Repair
```

---

# 🤖 Toward Real Autonomous Engineering

COMU is being developed toward a software-engineering loop rather than a single request/response interaction.

```text
UNDERSTAND
    ↓
PLAN
    ↓
INVESTIGATE
    ↓
IMPLEMENT
    ↓
VALIDATE
    ↓
DIAGNOSE
    ↓
REPAIR
    ↓
RE-VALIDATE
    ↓
CONCLUDE
```

This is the direction of the project.

The objective is not "generate code faster."

The objective is:

> **Make AI capable of participating in real software engineering workflows.**

---

# 🏗️ Architecture

COMU uses a layered architecture so contributors can improve one part without rewriting the whole system.

```text
┌─────────────────────────────────────────────────────────────┐
│                         VS Code                             │
│                                                             │
│  Webview UI                                                 │
│       ↓                                                     │
│  Extension Host                                             │
│       ↓                                                     │
│  Runtime Client / SSE / Session State                       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                         HTTP + SSE
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                    Local Agent Runtime                      │
│                                                             │
│  Task Lifecycle / API / Events                             │
│                     ↓                                       │
│              Agent Orchestrator                             │
│                     ↓                                       │
│          Planning / Verification                            │
│                     ↓                                       │
│            Diagnosis / Repair                               │
│                     ↓                                       │
│               Tool Executor                                 │
│                     ↓                                       │
│      Workspace / Terminal / Git / Validation                │
│                                                             │
│                     ↓                                       │
│           Canonical Model Provider API                      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                 ┌─────────────┼─────────────┐
                 ▼             ▼             ▼
              Hosted         Local         Future
              Models        Models        Providers
```

### Architectural boundaries

**VS Code layer**

Presentation, editor integration, secrets, workspace/editor APIs, and user interaction.

**Runtime**

Task lifecycle, streaming, session management, orchestration, policies, and tool execution.

**Agent Core**

Reasoning loop, lifecycle, planning, observation, verification, diagnosis, and repair.

**Tool Layer**

Filesystem, search, terminal, Git, validation, and future capabilities.

**Provider Layer**

Translation between COMU's canonical model interface and provider-specific APIs.

---

# 🔌 Models & Providers

COMU is **model agnostic by design**.

A provider is an adapter, not the agent itself.

```text
             COMU Agent
                 │
        Canonical Model API
                 │
      ┌──────────┼──────────┐
      ▼          ▼          ▼
   NVIDIA     OpenAI      Local
  / Nemotron  compatible   models
      │          │          │
      └──────────┼──────────┘
                 ▼
               Model
```

The project can support different combinations of:

- Hosted AI models.
- OpenAI-compatible endpoints.
- NVIDIA / Nemotron.
- Local inference servers.
- Ollama and similar local runtimes.
- Future community-built providers.

This makes COMU useful across different budgets, hardware, models, and deployment preferences.

> **One architecture. Many models. No model lock-in.**

---

# 🧩 Extensibility

COMU is intentionally built to be extended.

Contributors can work on areas such as:

```text
┌─────────────────────────────┐
│         COMU Core           │
├─────────────────────────────┤
│ Model Providers             │
│ Workspace Intelligence      │
│ Search Backends             │
│ Coding Tools                │
│ Terminal / Process Runtime  │
│ Git Integration             │
│ Validation                  │
│ Planning                    │
│ Diagnostics                 │
│ Repair                      │
│ Human Interaction           │
│ Memory                      │
│ Subagents                   │
│ VS Code UI                  │
│ Testing                     │
│ Security                    │
│ Documentation               │
└─────────────────────────────┘
```

You do not need to rewrite COMU to experiment with a new idea.

That is exactly why the architecture is modular.

---

# 🛡️ Security & Safety

AI agents interact with real files, processes, and development environments.

That makes safety an architectural problem.

COMU therefore emphasizes:

### Capability-based tools

Tools can declare capabilities such as:

```text
read
write
execute
network
```

### Workspace boundaries

Filesystem operations are intended to remain inside approved workspace roots, with protection against path traversal and symlink/real-path escapes.

### Explicit command policy

Commands are represented structurally rather than relying on arbitrary shell strings.

Policy categories can include:

```text
SAFE_DEVELOPMENT
RESTRICTED
DESTRUCTIVE
NETWORK
UNKNOWN
```

### Bounded autonomy

Tasks can be constrained by:

- Maximum steps.
- Maximum tool calls.
- Execution time.
- Command timeouts.
- Output limits.
- Repair attempts.
- Validation runs.
- Change scope.

### Integrity protection

Expected hashes, baseline snapshots, ChangeSets, and verification are used to make workspace changes observable and detect unexpected mutations.

### Fail closed

When the runtime cannot establish that an operation is safe or the workspace state is known, the preferred behavior is to stop and surface the problem rather than silently continue.

---

# 👤 Human Control

COMU is designed to become more autonomous while keeping the developer in control.

The system is being developed toward explicit human interactions for situations such as:

```text
Need clarification
       ↓
WAITING FOR USER
       ↓
User responds
       ↓
Resume task
```

and:

```text
Restricted operation
       ↓
Approval request
       ↓
User approves / denies
       ↓
Resume or stop
```

**Input and approval are intentionally different interaction types.**

---

# 🔄 Event-Driven Runtime

COMU uses structured events so the UI does not have to understand every internal implementation detail.

Examples:

```text
task.started
task.status.changed
plan.created
plan.updated
plan.step.started
plan.step.completed
tool.started
tool.completed
tool.failed
validation.started
validation.completed
diagnosis.created
repair.started
repair.completed
task.completed
task.failed
task.cancelled
```

This architecture supports:

- Live progress.
- Reconnection.
- Testing.
- Debugging.
- Alternate frontends.
- Future clients.
- Better observability.

---

# 🖥️ VS Code Experience

COMU integrates with VS Code as a development tool rather than trying to replace the editor.

The UI is intended to make the agent's work understandable.

It can expose:

- Provider and model selection.
- Runtime health.
- Workspace context.
- Task progress.
- Tool activity.
- Planning progress.
- Validation checks.
- Diagnosis.
- Repair history.
- Changed files.
- Native diffs.
- Cancellation.
- User input requests.
- Approval requests.

The UI remains a presentation layer; trusted operations remain in the extension host and runtime.

---

# 📦 Project Status

COMU is an actively evolving project.

The foundation has been developed incrementally through milestones covering:

| Milestone | Focus |
|---|---|
| M1 | Foundation, model abstraction, runtime, REST, streaming |
| M2 | Workspace intelligence and controlled tools |
| M3 | Coding agent, file changes, ChangeSets, tool calling, task lifecycle |
| M4 | VS Code integration, providers, secrets, UI, diff review |
| M5 | Terminal, process management, command policy, Git, validation |
| M6 | Autonomous engineering orchestration: planning, verification, diagnosis, bounded repair, human interaction |

The architecture is intentionally being built in stages.

**Reliability, observability, and control come before unrestricted autonomy.**

---

# 🗺️ Roadmap

The long-term roadmap is not limited to one coding workflow.

## Near-term

- Stronger planning.
- Better verification.
- Better failure diagnosis.
- Bounded automatic repair.
- Richer human interaction.
- More provider integrations.
- Better repository intelligence.
- Stronger test coverage.
- Improved developer experience.

## Medium-term

- Persistent workspace memory.
- Project architecture knowledge.
- Convention and decision tracking.
- Better task history.
- Specialized subagents.
- Research / implementation / testing / review roles.
- Scoped multi-agent execution.
- More advanced orchestration.

## Long-term vision

```text
                 ┌───────────────────┐
                 │   Developer       │
                 └─────────┬─────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │       COMU          │
                │ Engineering Agent   │
                └─────────┬───────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
    Planning          Execution         Verification
        │                 │                 │
        ▼                 ▼                 ▼
    Research           Coding            Testing
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ▼
                       Learning
                          │
                          ▼
                 Better next decisions
```

The ultimate goal is a general-purpose, open AI engineering agent that can grow with the community.

---

# 🌐 Why Open Source?

Closed systems can build excellent products.

But open systems can build **ecosystems**.

COMU is open so developers can:

- Understand how the agent works.
- Audit the architecture.
- Improve security.
- Add models that were not originally supported.
- Build local-first workflows.
- Experiment with new agent strategies.
- Share improvements with everyone.
- Fork the project for their own needs.
- Build specialized versions.
- Teach the project new capabilities.

A contributor's improvement should not belong to a single person forever.

It should have the opportunity to become part of the shared platform.

---

# 🤝 Contributing

## Everyone is welcome

You do not need to be the original author to contribute.

You can contribute:

- Code.
- Bug fixes.
- Security improvements.
- Tests.
- Documentation.
- Provider integrations.
- Model support.
- UI improvements.
- Performance improvements.
- Architecture proposals.
- Developer tooling.
- New tools.
- Better prompts and agent strategies.
- New validation strategies.

### Recommended workflow

```bash
git clone https://github.com/DipakThakur13/COMU
cd comu

pnpm install

pnpm build
pnpm typecheck
pnpm test
```

Create a feature branch:

```bash
git checkout -b feature/my-improvement
```

Make the change, add or update tests, then run the project's validation suite before opening a pull request.

### Pull requests

A useful pull request should explain:

1. **What changed**
2. **Why it changed**
3. **How it was tested**
4. **Any security implications**
5. **Any compatibility or migration considerations**

Large architectural changes should be discussed before significant implementation work whenever practical.

---

# 🛠️ Good First Contribution Areas

Looking for somewhere to start?

Some high-value areas include:

### Model ecosystem

Add a provider adapter or improve compatibility with an existing inference API.

### Developer tools

Build new workspace, Git, test, build, lint, or debugging tools.

### Intelligence

Improve search, context compilation, planning, diagnosis, or verification.

### Safety

Find ways to prevent command injection, path escapes, secret leakage, race conditions, excessive resource usage, or incorrect agent authority.

### UX

Improve the VS Code experience, progress visibility, diff review, settings, errors, and accessibility.

### Testing

Add regression tests and end-to-end scenarios that make the system more reliable.

### Documentation

Explain the architecture, APIs, contributor workflow, and extension points so more developers can participate.

---

# 🧪 Engineering Standards

COMU should become more capable **without becoming less trustworthy**.

Changes should follow these principles:

### 1. Do not hard-code a provider into agent-core

Provider-specific behavior belongs behind provider adapters.

### 2. Do not give the model authority simply because it requested it

The runtime owns permissions.

### 3. Prefer structured capabilities

Use tools and structured plans instead of arbitrary shell behavior.

### 4. Make changes observable

Agent modifications should be represented in the change/diff system.

### 5. Validate before claiming success

A model's statement is not proof.

### 6. Fail closed on uncertainty

Unknown workspace state, invalid authority, or ambiguous operations should not silently continue.

### 7. Preserve previous guarantees

Every milestone should keep the important safety and reliability guarantees of earlier milestones.

### 8. Make experimentation possible

Good architecture should make it easy to replace components rather than forcing contributors to modify the entire system.

---

# 🔑 Bring Your Own AI Provider (BYOK)

COMU is **model-agnostic** and operates on a strict **Bring Your Own Key (BYOK)** model.

> **Important Product Principle:**  
> COMU does **not** provide or resell AI inference subscriptions or credits.  
> You connect your own supported cloud provider account (such as NVIDIA Nemotron) or use a local open-weights model runner like Ollama.

### Supported Providers

| Provider | Model | Type | Configuration |
| :--- | :--- | :--- | :--- |
| **NVIDIA** | `Nemotron 3 Ultra` | Cloud API | API Key (`nvapi-...`) via UI or `NVIDIA_API_KEY` env |
| **Ollama** | `Llama 3 (Local)` | Local Inference | `http://localhost:11434` (zero external network) |
| **OpenAI-Compatible** | Configurable | Cloud / Local | Custom API Key & Base URL |
| **Anthropic-Compatible** | Configurable | Cloud / Local | Custom API Key & Base URL |

### Security & Secret Isolation Guarantees

1. **Secure Secret Storage**: API keys entered in the COMU UI are stored strictly in VS Code `SecretStorage` on your local device.
2. **Zero Plaintext Leakage**: Raw API keys are **never** rendered into Webview DOM, emitted into Server-Sent Events (SSE), saved into workspace memory, included in Git commits/diffs, or exposed in error logs.
3. **Task-Start Guard**: If you launch a task with a provider that lacks a configured key, COMU blocks execution with a clear alert and automatically opens the settings page—preventing unexpected 401 failures downstream.
4. **Live Connection Testing**: Test your provider setup directly in the UI before launching tasks with instant latency reporting and actionable error diagnostics.

For full setup instructions and troubleshooting, see [docs/PROVIDER_SETUP.md](docs/PROVIDER_SETUP.md).

---

# 🔐 Security Reporting

Security issues should be handled responsibly.

Please do not publicly publish sensitive exploit details before maintainers have had an opportunity to investigate.

Potential security areas include:

- Workspace boundary escapes.
- Symlink attacks.
- Command injection.
- Arbitrary process execution.
- Secret leakage.
- Unsafe provider integration.
- Tool authorization bypasses.
- Prompt/tool boundary failures.
- Resource exhaustion.
- Concurrent workspace mutation.
- Incorrect success reporting.

Security improvements are first-class contributions to COMU.

---

# 📜 License

COMU is intended to be released as an open-source project.

See the repository's [`LICENSE`](LICENSE) file for the exact license and redistribution terms.

**Do not assume permissions beyond what the repository license grants.**

---

# ❤️ The Community

COMU will only become truly useful if people improve it together.

Someone may contribute:

> a better local model integration.

Another person may contribute:

> safer command execution.

Another may build:

> a better planner.

Someone else may create:

> a better UI.

Another contributor may discover:

> a security flaw that prevents a future incident.

All of those contributions matter.

The project should improve because developers around the world are using it, testing it, questioning it, and rebuilding parts of it.

---

# ⭐ Help Build an Open AI Agent

COMU is not finished.

That is intentional.

There are still major problems to solve:

```text
Better reasoning
Better planning
Better context
Better code editing
Better verification
Better diagnosis
Better repair
Better memory
Better models
Better local inference
Better UX
Better security
Better agent coordination
Better developer workflows
```

The purpose of open source is not to present a perfect system.

It is to create a system that **everyone can improve**.

Fork it.

Experiment with it.

Break it.

Test it.

Secure it.

Add a new provider.

Build a better planner.

Create a new tool.

Improve the UI.

Share what you learn.

Submit a pull request.

Make it better for the next developer.

---

## 🌟 Our Goal

> **One open AI engineering agent.  
> Many models.  
> Many contributors.  
> No unnecessary lock-in.  
> Better software engineering for everyone.**

**COMU is built in the open. Help us build what comes next.**
