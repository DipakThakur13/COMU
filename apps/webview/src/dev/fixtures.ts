import type { AgentEvent } from "@comu/protocol";

/**
 * Recorded event sequences for the standalone harness.
 *
 * These are the shapes the runtime actually emits, so iterating on the interface never requires
 * reloading an extension host. They are fixtures, not simulations: nothing here invents a
 * capability the engine does not have.
 */

let seq = 0;
function e(type: string, extra: Record<string, unknown> = {}): AgentEvent {
  seq += 1;
  return {
    type,
    eventId: `fx-${seq}`,
    taskId: "fixture-task",
    timestamp: new Date(Date.UTC(2026, 8, 20, 10, 0, seq)).toISOString(),
    ...extra
  } as AgentEvent;
}

const plan = {
  planId: "plan-fixture",
  taskId: "fixture-task",
  version: 1,
  goal: "Add rate limiting to the login endpoint",
  status: "READY",
  steps: [
    { id: "s1", type: "INVESTIGATE", title: "Locate the login handler", description: "Find the route and its middleware chain.", dependencies: [], status: "COMPLETED", attempts: 1, resultSummary: "Found src/auth/login.ts" },
    { id: "s2", type: "IMPLEMENT", title: "Add a rate limiter", description: "Introduce a bounded per-IP limiter.", dependencies: ["s1"], status: "RUNNING", attempts: 1 },
    { id: "s3", type: "VALIDATE", title: "Run the verification suite", description: "Typecheck, lint and tests.", dependencies: ["s2"], status: "PENDING", attempts: 0 }
  ],
  createdAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-20T10:00:00.000Z"
};

const approvalInteraction = {
  interactionId: "act-fixture-1",
  taskId: "fixture-task",
  type: "APPROVAL",
  title: "Approval required: Modify src/auth/login.ts (+12 -3)",
  message: "Modify src/auth/login.ts: +12 -3. Review the diff below.",
  status: "PENDING",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  approval: {
    kind: "file_write",
    tool: "write_file",
    summary: "Modify src/auth/login.ts (+12 -3)",
    file: {
      path: "src/auth/login.ts",
      operation: "MODIFY",
      additions: 12,
      deletions: 3,
      diff: [
        "Index: src/auth/login.ts",
        "===================================================================",
        "--- src/auth/login.ts\toriginal",
        "+++ src/auth/login.ts\tmodified",
        "@@ -1,8 +1,17 @@",
        " import { Router } from \"express\";",
        "+import { rateLimit } from \"./rate_limit.js\";",
        " ",
        " export const loginRouter = Router();",
        " ",
        "-loginRouter.post(\"/login\", async (req, res) => {",
        "-  const user = await authenticate(req.body);",
        "-  res.json({ user });",
        "+const limiter = rateLimit({ windowMs: 60_000, max: 10 });",
        "+",
        "+loginRouter.post(\"/login\", limiter, async (req, res) => {",
        "+  const user = await authenticate(req.body);",
        "+  if (!user) {",
        "+    res.status(401).json({ error: \"INVALID_CREDENTIALS\" });",
        "+    return;",
        "+  }",
        "+  res.json({ user });",
        " });"
      ].join("\n")
    },
    scopes: [
      { key: "file:src/auth/login.ts", label: "Approve writes to src/auth/login.ts for this session" },
      { key: "dir:src/auth/", label: "Approve writes under src/auth/ for this session" },
      { key: "writes:*", label: "Approve all writes for this session" }
    ]
  }
};

const startup: AgentEvent[] = [
  e("task.started"),
  e("task.mode_resolved", { mode: "AGENT", source: "explicit", confidence: 1, reasons: ["mode selected by user"] }),
  e("agent.status", { status: "ANALYZING" }),
  e("memory.retrieved", { count: 2 }),
  e("plan.created", { planId: plan.planId, planVersion: 1, plan }),
  e("plan.step.started", { planId: plan.planId, planVersion: 1, stepId: "s1" }),
  e("agent.status", { status: "THINKING" }),
  e("tool.started", { tool: "search_text", pattern: "loginRouter" }),
  e("tool.completed", { tool: "search_text", result: { matches: [{ file: "src/auth/login.ts", line: 4 }] } }),
  e("tool.started", { tool: "read_file", path: "src/auth/login.ts" }),
  e("tool.completed", { tool: "read_file", path: "src/auth/login.ts", result: { path: "src/auth/login.ts" } }),
  e("tool.completed", { tool: "read_file", path: "src/auth/rate_limit.ts", result: { path: "src/auth/rate_limit.ts" } }),
  e("tool.completed", { tool: "read_file", path: "src/server.ts", result: { path: "src/server.ts" } }),
  e("plan.step.completed", { planId: plan.planId, planVersion: 1, stepId: "s1", resultSummary: "Found src/auth/login.ts" }),
  e("plan.step.started", { planId: plan.planId, planVersion: 1, stepId: "s2" })
];

const streamingTail: AgentEvent[] = [
  e("model_request.created", { requestId: "req-fx-1", runId: "fixture-task", attempt: 1 }),
  ...["I will add a bounded per-IP rate limiter ", "to the login route, then run the ", "verification suite to confirm nothing regressed."].map((text, index) =>
    e("model.token_delta", { requestId: "req-fx-1", runId: "fixture-task", channel: "main", kind: "text", delta: text, index })
  )
];

const completedTail: AgentEvent[] = [
  e("model_request.succeeded", {
    requestId: "req-fx-1",
    runId: "fixture-task",
    attempt: 1,
    latencyMs: 2400,
    usage: { promptTokens: 18450, completionTokens: 890, totalTokens: 19340 },
    costUsd: 0.0421
  }),
  e("change.created", { path: "src/auth/login.ts", operation: "MODIFY" }),
  e("change.created", { path: "src/auth/rate_limit.ts", operation: "CREATE" }),
  e("plan.step.completed", { planId: plan.planId, planVersion: 1, stepId: "s2", resultSummary: "Limiter added" }),
  e("plan.step.started", { planId: plan.planId, planVersion: 1, stepId: "s3" }),
  e("verification.started", { verificationId: "v1" }),
  e("verification.completed", {
    verificationId: "v1",
    result: {
      verificationId: "v1",
      taskId: "fixture-task",
      status: "PASSED",
      durationMs: 18400,
      timestamp: new Date().toISOString(),
      summary: "All required checks passed",
      checks: [
        { id: "c1", name: "Typecheck", required: true, status: "PASSED" },
        { id: "c2", name: "Test Suite", required: true, status: "PASSED" },
        { id: "c3", name: "Lint", required: false, status: "PASSED" },
        { id: "c4", name: "Build", required: false, status: "SKIPPED", skipReason: "No build script detected" }
      ]
    }
  }),
  e("plan.step.completed", { planId: plan.planId, planVersion: 1, stepId: "s3", resultSummary: "All checks passed" }),
  e("task.completed", { finalText: "Added a per-IP rate limiter to the login route and a new rate_limit helper. Typecheck and tests pass." })
];

export interface Fixture {
  id: string;
  label: string;
  description: string;
  events: AgentEvent[];
}

export const FIXTURES: Fixture[] = [
  {
    id: "idle",
    label: "Idle",
    description: "No task running: the empty state and the composer.",
    events: []
  },
  {
    id: "running",
    label: "Running",
    description: "A task mid-flight with a plan, grouped reads and text streaming in.",
    events: [...startup, ...streamingTail]
  },
  {
    id: "approval",
    label: "Pending approval",
    description: "Blocked on a human decision, with a real diff and three scope grants.",
    events: [
      ...startup,
      e("agent.status", { status: "Waiting for approval: Modify src/auth/login.ts (+12 -3)" }),
      e("interaction.requested", { interactionId: "act-fixture-1", interaction: approvalInteraction })
    ]
  },
  {
    id: "completed",
    label: "Completed",
    description: "A finished task with changes, verification and a usage total.",
    events: [...startup, ...streamingTail, ...completedTail]
  },
  {
    id: "failed",
    label: "Failed",
    description: "Verification failed, diagnosed, repaired and failed again.",
    events: [
      ...startup,
      e("verification.completed", {
        verificationId: "v2",
        result: {
          verificationId: "v2",
          taskId: "fixture-task",
          status: "FAILED",
          durationMs: 9100,
          timestamp: new Date().toISOString(),
          summary: "Verification FAILED: 1 failed, 1 skipped",
          checks: [
            { id: "c1", name: "Typecheck", required: true, status: "FAILED", details: "src/auth/login.ts(12,7): error TS2554" },
            { id: "c2", name: "Test Suite", required: true, status: "SKIPPED", skipReason: "Typecheck failed first" }
          ]
        }
      }),
      e("diagnosis.created", {
        diagnosisId: "d1",
        diagnosis: { diagnosisId: "d1", failureType: "TYPE_ERROR", summary: "rateLimit expects one argument, two given", affectedFiles: ["src/auth/login.ts"], confidence: 0.9 }
      }),
      e("repair.started", { repairAttemptId: "rep-1", attemptNumber: 1, targetFiles: ["src/auth/login.ts"] }),
      e("repair.failed", { repairAttemptId: "rep-1", attemptNumber: 1, reason: "Same failure fingerprint after repair" }),
      e("task.failed", { error: "Repair limit reached", payload: { code: "DUPLICATE_REPAIR_STRATEGY", message: "The same repair was attempted twice with the same result." } })
    ]
  },
  {
    id: "long",
    label: "Long run",
    description: "Twelve hundred events, for checking virtualisation and the elided affordance.",
    events: [
      ...startup,
      ...Array.from({ length: 1200 }, (_, i) =>
        i % 5 === 0
          ? e("tool.completed", { tool: "read_file", path: `src/module_${i}/index.ts`, result: { path: `src/module_${i}/index.ts` } })
          : e("agent.status", { status: i % 2 === 0 ? "THINKING" : "TOOL_CALLING" })
      ),
      ...completedTail
    ]
  }
];

export function fixtureById(id: string | null): Fixture {
  return FIXTURES.find(f => f.id === id) ?? FIXTURES[0];
}
