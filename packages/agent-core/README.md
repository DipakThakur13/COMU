# @comu/agent-core

Core autonomous agent orchestration engine, state machine, and subagent coordination for COMU.

## Overview

`@comu/agent-core` contains the brain of COMU. It orchestrates the autonomous engineering loop: planning changes, compiling context, calling tools, inspecting diffs, verifying results, and repairing issues.

## Architecture

- **AgentKernel**: The core Finite State Machine (FSM) enforcing transitions from `IDLE` through `COMPLETED` / `FAILED` / `CANCELLED`.
- **AgentOrchestrator**: High-level workflow coordinator executing plan steps, managing token budgets, and handling human approvals.
- **IntentRouter**: Classifies tasks into `AUTO`, `AGENT`, `PLAN`, `ASK`, or `CHAT` interaction modes.
- **Subagent Coordinators**: Manages specialized subagents such as Research Workers (codebase exploration) and Verification Workers (automated test suites).
- **ExecutionTrace**: Structured telemetry tracking step durations, tool performance, and completion gates.

## License

MIT © Dipak Kumar (Boswas Group)
