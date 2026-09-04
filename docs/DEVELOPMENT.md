# COMU Development & Contribution Guide

## 1. Prerequisites

- **Node.js**: >= 20.0.0
- **PNPM**: >= 8.0.0
- **TypeScript**: 5.x
- **VS Code**: >= 1.85.0 (for extension development)

---

## 2. Monorepo Setup

Install dependencies:
```bash
pnpm install
```

Build all packages and apps:
```bash
pnpm build
```

Run TypeScript typecheck across all projects:
```bash
pnpm typecheck
```

---

## 3. Running Tests

Run the full Vitest unit and E2E test suite:
```bash
pnpm vitest run
```

Run targeted package tests:
```bash
# Planning Engine tests
pnpm --filter @comu/planning-engine test

# Verification Engine tests
pnpm --filter @comu/verification-engine test

# Diagnostics Engine tests
pnpm --filter @comu/diagnostics-engine test

# Repair Engine tests
pnpm --filter @comu/repair-engine test

# Agent Core tests
pnpm --filter @comu/agent-core test

# Milestone 6 E2E Scenarios
pnpm vitest run apps/agent-runtime/tests/m6_e2e.test.ts

# Milestone 7 Packages & E2E Scenarios
pnpm --filter @comu/memory-engine test
pnpm --filter @comu/tool-web-docs test
pnpm vitest run tools/git
pnpm vitest run apps/agent-runtime/tests/m7_e2e.test.ts
```

---

## 4. Running the Local Development Runtime

Start the Agent Runtime server locally:
```bash
pnpm --filter @comu/agent-runtime dev
```
The server will start on `http://localhost:3456` (or the configured `PORT`).

### Useful Endpoints:
- `POST /v1/tasks`: Create and start a task.
- `GET /v1/tasks/:id/events`: SSE event stream for streaming task events.
- `GET /v1/tasks/:id/plan`: Inspect current task plan.
- `GET /v1/tasks/:id/verification`: Inspect latest verification result.
- `GET /v1/tasks/:id/interactions`: List pending interactions.
- `POST /v1/tasks/:id/interactions/:interactionId/respond`: Submit approval or input response.
- `POST /v1/tasks/:id/cancel`: Cancel an active task.
- `GET /v1/workspace/memory`: Query persistent workspace conventions, lessons, and episodes.
- `POST /v1/workspace/memory`: Record user conventions with `USER_VERIFIED` trust.
- `DELETE /v1/workspace/memory/:id`: Invalidate or delete memory entries.
- `GET /v1/tasks/:taskId/subagents`: Inspect supervised worker executions.

---

## 5. VS Code Extension Development

1. Open the repository root in VS Code.
2. Build the extension:
   ```bash
   pnpm --filter comu-ai build
   ```
3. Launch the Extension Development Host by pressing `F5` (or selecting "Run Extension" in the Debug view).
4. The COMU sidebar will appear in the primary activity bar.

