# @comu/protocol

Shared TypeScript types, RPC schemas, and event protocol definitions for COMU.

## Overview

`@comu/protocol` is the canonical protocol specification governing communication between the COMU Agent Runtime, the VS Code Extension Host, and the Webview Presentation Layer.

## Core Schemas

- **Agent Events (`AgentEvent`)**: Strongly typed union of lifecycle events (`agent.status`, `plan.created`, `plan.step.started`, `tool.started`, `tool.completed`, `change.created`, `verification.completed`, `diagnosis.created`, `repair.started`, `interaction.requested`, `task.completed`, `task.cancelled`, `task.failed`).
- **Task Contract (`TaskContract`)**: Complete description of user requests, active workspace context, editor state, and intent classification.
- **Structured Plan (`TaskPlan`, `PlanStep`)**: Versioned implementation plan checklist with step dependencies and status tracking.
- **Verification (`VerificationResult`, `VerificationCheck`)**: Matrix of automated test passes, linter results, and typechecks.
- **Provider Interfaces (`ProviderConfig`, `ProviderModel`, `ProviderTestResult`)**: Multi-provider metadata definitions for BYOK integration.

## License

MIT © Dipak Kumar (Boswas Group)
