# COMU Agent Specification & Orchestration Lifecycle

## 1. Overview

Milestone 6 introduces Autonomous Engineering Orchestration to COMU. Rather than blindly executing arbitrary tool calls in an open loop, COMU operates through a structured engineering lifecycle:

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
DIAGNOSE (if validation failed)
    ↓
REPAIR
    ↓
RE-VALIDATE
    ↓
VERIFY WORKSPACE INTEGRITY
    ↓
CONCLUDE
```

---

## 2. Agent State Machine

The agent lifecycle is governed by canonical states defined in `@comu/protocol`:

| State | Description |
| :--- | :--- |
| `IDLE` | Task created or pending start. |
| `STARTING` | Environment initialization and tool context setup. |
| `ANALYZING` | Task requirement analysis and complexity estimation. |
| `PLANNING` | Structured plan creation and dependency validation. |
| `THINKING` | LLM reasoning over active context and prior observations. |
| `TOOL_CALLING` | Controlled tool invocation via `ToolExecutor`. |
| `OBSERVING` | Digesting tool execution outputs into message memory. |
| `VERIFYING` | Deterministic verification suite execution and aggregation. |
| `DIAGNOSING` | Failure classification, evidence extraction, and fingerprinting. |
| `REPAIRING` | Planning and applying targeted repairs within bounded budgets. |
| `WAITING_FOR_USER` | True execution pause awaiting developer input or approval. |
| `COMPLETED` | Authoritative completion gate satisfied with passing evidence. |
| `FAILED` | Unrecoverable error or invariant violation. |
| `CANCELLED` | Execution stopped gracefully via `AbortSignal`. |
| `LIMIT_REACHED` | Exhausted step, tool call, time, or repair attempt limit. |

---

## 3. Planning Engine (`@comu/planning-engine`)

### 3.1 Plan Structure
Every task plan conforms to `TaskPlan`:
- `planId`: Unique plan identifier.
- `taskId`: Associated task.
- `version`: Plan version number (increments on dynamic mutation).
- `goal`: High-level goal.
- `steps`: Ordered list of `PlanStep` elements.
- `status`: Plan lifecycle status (`DRAFT`, `READY`, `EXECUTING`, `VERIFYING`, `WAITING_FOR_USER`, `COMPLETED`, `FAILED`, `BLOCKED`).

Each step contains:
- `id`: Non-empty unique string (e.g. `step-1-investigate`).
- `type`: Step classification (`INVESTIGATE`, `IMPLEMENT`, `VALIDATE`, `DIAGNOSE`, `REPAIR`, `USER_INPUT`).
- `dependencies`: List of step IDs that must complete before this step is eligible.
- `status`: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `BLOCKED`, `SKIPPED`.

### 3.2 Plan Validation (`PlanValidator`)
The planner validates plans using Kahn's topological sorting algorithm:
1. Verifies step IDs are non-empty and globally unique within the plan.
2. Checks that all dependency references point to existing step IDs.
3. Detects circular dependencies deterministically (rejects cycles).
4. Verifies plan step bounds (1–20 steps).

### 3.3 Dynamic Mutation & Versioning
When a validation step fails, the planner mutates the plan:
1. Increments `TaskPlan.version`.
2. Emits `plan.updated` event with mutation reason.
3. Preserves completed steps and historical attempts.
4. Injects diagnosis (`DIAGNOSE`), targeted repair (`REPAIR`), and re-validation (`VALIDATE`) steps.
5. Updates dependencies of subsequent steps to point to the new re-validation step.
6. Validates the mutated plan before resumption.

---

## 4. Verification Engine (`@comu/verification-engine`)

### 4.1 Deterministic Policy (`VerificationPolicy`)
Verification requirements are determined by workspace analysis and changed files:
- **Documentation Changes (`.md`, `.txt`)**: Build and tests may be safely skipped with an explicit documented reason.
- **TypeScript / JavaScript Changes (`.ts`, `.tsx`, `.js`)**: Typecheck is `REQUIRED`. Tests are `REQUIRED` when available.
- **Test File Changes (`.test.ts`, `.spec.ts`)**: Relevant test execution is `REQUIRED`.
- **Package / Dependency Changes (`package.json`, lockfiles)**: Build and typecheck are `REQUIRED`.

### 4.2 Authoritative Aggregation (`ResultAggregator`)
A verification run produces a `VerificationResult` containing individual `VerificationCheck` records:
- For every **REQUIRED** check:
  - `PASSED`: Verification succeeds.
  - `FAILED`: Blocks task completion.
  - `UNAVAILABLE`: Blocks task completion.
  - `PARTIAL`: Blocks task completion.
- **OPTIONAL** checks do not block completion unless marked critical.

### 4.3 Workspace Integrity (`WorkspaceIntegrityVerifier`)
Before completion, COMU verifies that no unrecorded or external mutations corrupted the workspace:
- Compares baseline OCC file hashes against on-disk state.
- Detects external changes (`CHANGED_EXTERNALLY`), race conflicts (`CONFLICT`), or unverified states (`UNKNOWN`).
- Blocks completion unless integrity is strictly `VERIFIED`.

---

## 5. Diagnostics Engine (`@comu/diagnostics-engine`)

### 5.1 Evidence Extraction (`EvidenceExtractor`)
Extracts structured diagnostic information from verification outputs:
- Compiler error codes (e.g. `TS2345`, `TS2304`).
- Stack traces and file locations (`path:line:col`).
- Test failure assertions (e.g. `AssertionError: expected 401 to be 200`).
- Exit codes, stdout excerpts, and bounded stderr.

### 5.2 Failure Classification
Classifies failures into canonical categories:
`TYPE_ERROR`, `TEST_FAILURE`, `BUILD_FAILURE`, `LINT_FAILURE`, `RUNTIME_ERROR`, `COMMAND_FAILURE`, `TIMEOUT`, `CONFIGURATION_ERROR`, `DEPENDENCY_ERROR`, `UNKNOWN`.

### 5.3 Deterministic Fingerprinting (`FingerprintGenerator`)
To prevent infinite or identical retry loops, COMU computes SHA-256 fingerprints:
1. `failureFingerprint`: `sha256(type + affectedFiles + errorSignature)`
2. `repairStrategyFingerprint`: `sha256(strategyType + targetFiles + rationale)`
3. `repairAttemptFingerprint`: `sha256(failureFp + strategyFp + targetFiles + proposedDiff)`

---

## 6. Repair Engine (`@comu/repair-engine`)

### 6.1 Policy & Budget Limits
Default task-scoped limits:
- `maxRepairAttempts`: 3 attempts.
- `maxValidationRuns`: 6 runs.
- `maxRepairFiles`: 5 files.
- `maxRepairTimeMs`: 180,000 ms (3 minutes).

### 6.2 Duplicate Strategy Prevention
Before approving a repair attempt, `RepairEngine` checks:
- Has this exact failure already been attempted with the same repair strategy?
- If yes, rejects with `DUPLICATE_REPAIR_STRATEGY` to prevent repetitive loops.
- Stops execution with `LIMIT_REACHED` or requests user intervention.

---

## 7. Human Interaction (`InteractionManager`)

When COMU encounters ambiguity or requires elevated permissions:
1. Creates an `InteractionRequest`:
   - `INPUT`: Asks a clarifying question with optional choices.
   - `APPROVAL`: Requests permission for a restricted or sensitive operation.
2. Changes state to `WAITING_FOR_USER`.
3. **True Task Pausing**: Pauses execution using a Promise resolver without busy-polling or token consumption.
4. **Resolution**: Developer responds via REST API or VS Code Webview:
   - `APPROVE`: Resumes execution with granted permission.
   - `DENY`: Halts or safely adapts according to policy.
   - `INPUT`: Resumes with developer input injected into context.
5. **Expiration Handling**:
   - Expired `INPUT` fails cleanly with `USER_INPUT_TIMEOUT`.
   - Expired `APPROVAL` is treated strictly as **NOT GRANTED**.

---

## 8. Authoritative Completion Gate

A model response cannot mark a task as completed. Task completion requires:
```typescript
const passesCompletionGate =
  implementationComplete &&
  requiredVerificationPassed &&
  noCriticalFailures &&
  workspaceIntegrityVerified &&
  noPendingInteraction &&
  withinLimits &&
  changeSetValid &&
  executionStateKnown;
```
If any condition evaluates to false, the completion transition is rejected.

---

## 9. Milestone 7: Memory Retrieval & Supervised Workers

### 9.1 Memory Query & Injection
Before planning, `AgentOrchestrator` queries the `MemoryEngine`:
- Extracts verified workspace conventions and lessons relevant to the task prompt.
- Appends memory as supplementary context while explicitly preserving current workspace files as ground truth.
- After completion, records structured `TaskEpisode` and verified `LESSON` entries with provenance.

### 9.2 Supervised Worker Agents (`SubagentManager`)
- The orchestrator can invoke `delegate_subtask` to spawn a single-level worker (`RESEARCH` or `VERIFICATION`).
- Workers are strictly read-only / validation-only (`maxSubagentDepth = 1`).
- Master accounts worker tool calls and steps towards the parent budget.
- Parent cancellation aborts active workers instantly.

---

## 10. Milestone 7: Controlled Git Governance Pipeline

Downstream of the Completion Gate:
1. **Commit Proposal:** COMU proposes a conventional commit message based on verified changes.
2. **Review & Approval:** Developer can inspect, edit, approve, or deny via VS Code UI or API.
3. **Staging & Diff Verification:** COMU stages only authorized ChangeSet files and verifies cached diff matches ChangeSet.
4. **Controlled Commit:** Executes `git commit`.
5. **Optional Human-Approved Push:** Developer explicitly approves `git push`. Automatic push is impossible.

