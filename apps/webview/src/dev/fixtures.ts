import type { AgentEvent, WorkspaceMemoryEntry } from "@comu/protocol";

/**
 * Recorded event sequences for the standalone harness.
 *
 * These are the shapes the runtime actually emits, so iterating on the interface never requires
 * reloading an extension host. They are fixtures, not simulations: nothing here invents a
 * capability the engine does not have.
 */

/** Shared so fixture content can be written as line arrays without escaping. */
const NEWLINE = String.fromCharCode(10);

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

const createInteraction = {
  interactionId: "act-fixture-2",
  taskId: "fixture-task",
  type: "APPROVAL",
  title: "Approval required: Create src/auth/rate_limit.ts (+18 -0)",
  message: "Create src/auth/rate_limit.ts: +18 -0. Review the file below.",
  status: "PENDING",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
  approval: {
    kind: "file_write",
    tool: "create_file",
    summary: "Create src/auth/rate_limit.ts (+18 -0)",
    file: {
      path: "src/auth/rate_limit.ts",
      operation: "CREATE",
      additions: 18,
      deletions: 0,
      diff: "",
      content: [
        "interface Bucket {",
        "  count: number;",
        "  resetAt: number;",
        "}",
        "",
        "const buckets = new Map<string, Bucket>();",
        "",
        "export function rateLimit(options: { windowMs: number; max: number }) {",
        "  return (req: { ip: string }, res: { status: (c: number) => void }, next: () => void) => {",
        "    const now = Date.now();",
        "    const bucket = buckets.get(req.ip);",
        "    if (!bucket || bucket.resetAt < now) {",
        "      buckets.set(req.ip, { count: 1, resetAt: now + options.windowMs });",
        "      return next();",
        "    }",
        "    bucket.count += 1;",
        "    if (bucket.count > options.max) return res.status(429);",
        "    next();",
        "  };",
        "}"
      ].join(NEWLINE)
    },
    scopes: [
      { key: "file:src/auth/rate_limit.ts", label: "Approve writes to src/auth/rate_limit.ts for this session" },
      { key: "dir:src/auth/", label: "Approve writes under src/auth/ for this session" },
      { key: "writes:*", label: "Approve all writes for this session" }
    ]
  }
};

const commandInteraction = {
  interactionId: "act-fixture-3",
  taskId: "fixture-task",
  type: "APPROVAL",
  title: "Approval required: Run npm run test:integration -- --runInBand",
  message: "Run the command below.",
  status: "PENDING",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 45 * 1000).toISOString(),
  approval: {
    kind: "command",
    tool: "execute_command",
    summary: "Run npm run test:integration -- --runInBand",
    command: {
      executable: "npm",
      args: ["run", "test:integration", "--", "--runInBand"],
      cwd: "/home/dev/checkout/packages/api"
    },
    scopes: [{ key: "cmd:npm run test:integration -- --runInBand", label: "Approve this exact command for this session" }]
  }
};

const pushInteraction = {
  interactionId: "act-fixture-4",
  taskId: "fixture-task",
  type: "APPROVAL",
  title: "Approval required: Push branch fix/rate-limit to origin",
  message: "Push to a remote.",
  status: "PENDING",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 8 * 60 * 1000).toISOString(),
  approval: {
    kind: "git_push",
    tool: "git_push",
    summary: "Push branch fix/rate-limit to origin",
    details: { remote: "origin", branch: "fix/rate-limit" },
    scopes: []
  }
};

const startup: AgentEvent[] = [
  e("task.started"),
  e("task.mode_resolved", { mode: "AGENT", source: "explicit", confidence: 1, reasons: ["mode selected by user"] }),
  e("agent.status", { status: "Analyzing task and workspace requirements", state: "ANALYZING" }),
  e("memory.retrieved", { count: 2 }),
  e("plan.created", { planId: plan.planId, planVersion: 1, plan }),
  e("plan.step.started", { planId: plan.planId, planVersion: 1, stepId: "s1" }),
  e("agent.status", { status: "Thinking...", state: "THINKING" }),
  e("agent.status", { status: "Executing tools...", state: "TOOL_CALLING" }),
  e("tool.started", { tool: "list_directory", target: "src/auth", toolCallId: "c0" }),
  e("tool.completed", {
    tool: "list_directory",
    target: "src/auth",
    toolCallId: "c0",
    result: [{ name: "login.ts" }, { name: "rate_limit.ts" }, { name: "session.ts" }]
  }),
  e("tool.started", { tool: "search_text", target: "loginRouter", toolCallId: "c1" }),
  e("tool.completed", {
    tool: "search_text",
    target: "loginRouter",
    toolCallId: "c1",
    result: { matches: [{ path: "src/auth/login.ts", line: 4 }, { path: "src/server.ts", line: 18 }] }
  }),
  e("tool.started", { tool: "read_file", target: "src/auth/login.ts", toolCallId: "c2" }),
  e("tool.completed", { tool: "read_file", target: "src/auth/login.ts", toolCallId: "c2", result: { path: "src/auth/login.ts", lineCount: 64 } }),
  e("tool.completed", { tool: "read_file", target: "src/auth/rate_limit.ts", result: { path: "src/auth/rate_limit.ts", lineCount: 21 } }),
  e("tool.completed", { tool: "read_file", target: "src/server.ts", result: { path: "src/server.ts", lineCount: 132 } }),
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
  e("change.created", { path: "src/auth/login.ts", operation: "MODIFY", additions: 12, deletions: 3 }),
  e("change.created", { path: "src/auth/rate_limit.ts", operation: "CREATE", additions: 18, deletions: 0 }),
  e("plan.step.completed", { planId: plan.planId, planVersion: 1, stepId: "s2", resultSummary: "Limiter added" }),
  e("plan.step.started", { planId: plan.planId, planVersion: 1, stepId: "s3" }),
  e("tool.started", { tool: "execute_command", target: "npm test", toolCallId: "c9" }),
  e("tool.completed", {
    tool: "execute_command",
    target: "npm test",
    toolCallId: "c9",
    result: {
      executable: "npm",
      args: ["test"],
      exitCode: 0,
      stdout: ["> api@1.0.0 test", "", "  42 passing (1.2s)"].join(NEWLINE),
      stderr: "",
      durationMs: 1200
    }
  }),
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
  /** Memory arrives as its own host message rather than as a task event, so it is carried here. */
  memories?: WorkspaceMemoryEntry[];
}

const memories: WorkspaceMemoryEntry[] = [
  {
    id: "mem-1",
    workspaceId: "fixture",
    type: "CONVENTION",
    content: "Route handlers live under src/auth and are registered in src/server.ts.",
    source: "USER",
    trustLevel: "USER_VERIFIED",
    confidence: 1,
    createdAt: "2026-09-12T09:00:00.000Z",
    updatedAt: "2026-09-12T09:00:00.000Z",
    status: "ACTIVE",
    scope: { workspaceId: "fixture", files: ["src/server.ts"] },
    contentHash: "h1"
  },
  {
    id: "mem-2",
    workspaceId: "fixture",
    type: "LESSON",
    content: "The integration suite needs a running Redis; it fails with ECONNREFUSED otherwise.",
    source: "VERIFICATION",
    trustLevel: "VERIFIED_EVIDENCE",
    confidence: 0.95,
    createdAt: "2026-09-14T11:30:00.000Z",
    updatedAt: "2026-09-14T11:30:00.000Z",
    status: "ACTIVE",
    scope: { workspaceId: "fixture" },
    contentHash: "h2"
  },
  {
    id: "mem-3",
    workspaceId: "fixture",
    type: "EPISODE",
    content: "Rate limiting was attempted once before and reverted for breaking the health check.",
    source: "AGENT",
    trustLevel: "AGENT_DERIVED",
    confidence: 0.4,
    createdAt: "2026-08-30T16:00:00.000Z",
    updatedAt: "2026-09-18T08:00:00.000Z",
    status: "STALE",
    scope: { workspaceId: "fixture", files: ["src/auth/login.ts"] },
    contentHash: "h3"
  }
];

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
      e("agent.status", { status: "Waiting for approval: Modify src/auth/login.ts (+12 -3)", state: "WAITING_FOR_USER" }),
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
      e("agent.limit_reached", { limit: "duplicateRepairStrategy" }),
      e("task.failed", { error: "Repair limit reached", payload: { code: "DUPLICATE_REPAIR_STRATEGY", message: "The same repair was attempted twice with the same result." } })
    ]
  },
  {
    id: "approval-create",
    label: "Pending approval (new file)",
    description: "A created file renders as the file itself, not a diff against nothing.",
    events: [
      ...startup,
      e("agent.status", { status: "Waiting for approval: Create src/auth/rate_limit.ts (+18 -0)", state: "WAITING_FOR_USER" }),
      e("interaction.requested", { interactionId: "act-fixture-2", interaction: createInteraction })
    ]
  },
  {
    id: "approval-command",
    label: "Pending approval (command)",
    description: "The exact argument vector and cwd, never a joined shell string. Countdown is urgent.",
    events: [
      ...startup,
      e("agent.status", { status: "Waiting for approval: Run npm run test:integration", state: "WAITING_FOR_USER" }),
      e("interaction.requested", { interactionId: "act-fixture-3", interaction: commandInteraction })
    ]
  },
  {
    id: "approval-push",
    label: "Pending approval (push)",
    description: "Marked distinctly and offers no session grant, in any autonomy level.",
    events: [
      ...startup,
      e("agent.status", { status: "Waiting for approval: Push branch fix/rate-limit", state: "WAITING_FOR_USER" }),
      e("interaction.requested", { interactionId: "act-fixture-4", interaction: pushInteraction })
    ]
  },
  {
    id: "changes",
    label: "Changes tab",
    description: "The read-only aggregate review of every written file.",
    events: [...startup, ...streamingTail, ...completedTail]
  },
  {
    id: "drawer",
    label: "Drawer surfaces",
    description: "Overview, verification, workers and memory all populated, for the drawer strip.",
    events: [
      ...startup,
      e("subagent.started", { subagentId: "sub-1", subagentType: "research", goal: "Find every call site of rateLimit" }),
      e("subagent.started", { subagentId: "sub-2", subagentType: "review", goal: "Check the change against the style guide" }),
      e("subagent.completed", { subagentId: "sub-1", subagentType: "research", result: { summary: "Three call sites, all in src/auth." } }),
      e("approval.decided", { tool: "write_file", kind: "file_write", summary: "Modify src/auth/login.ts (+12 -3)", approved: true, decision: "APPROVED_SESSION", scopeKey: "dir:src/auth/", path: "src/auth/login.ts" }),
      e("approval.decided", { tool: "execute_command", kind: "command", summary: "Run npm run test:integration", approved: false, decision: "TIMEOUT" }),
      e("approval.decided", { tool: "git_push", kind: "git_push", summary: "Push branch fix/rate-limit", approved: false, decision: "DENIED" }),
      ...streamingTail,
      ...completedTail
    ],
    memories
  },
  {
    id: "chat",
    label: "Chat turn",
    description: "A conversational reply: the answer, and nothing else around it.",
    events: [
      e("task.started"),
      e("task.mode_resolved", { mode: "CHAT", source: "deterministic", confidence: 1, reasons: ["mode selected by user"] }),
      e("agent.status", { status: "Thinking...", state: "THINKING" }),
      e("model_request.created", { requestId: "req-chat", runId: "fixture-task", attempt: 1 }),
      ...[
        "The limiter is per IP and bounded: ",
        "each bucket holds a count and an expiry, ",
        "and buckets are dropped as they expire."
      ].map((text, index) =>
        e("model.token_delta", { requestId: "req-chat", runId: "fixture-task", channel: "main", kind: "text", delta: text, index })
      ),
      e("model_request.succeeded", {
        requestId: "req-chat",
        runId: "fixture-task",
        attempt: 1,
        latencyMs: 900,
        usage: { promptTokens: 620, completionTokens: 48, totalTokens: 668 },
        costUsd: 0.0009
      }),
      e("task.completed", {
        finalText:
          "The limiter is per IP and bounded: each bucket holds a count and an expiry, and buckets are dropped as they expire."
      })
    ]
  },
  {
    id: "long",
    label: "Long run",
    description: "Twelve hundred events, for checking virtualisation and the elided affordance.",
    events: [
      ...startup,
      ...Array.from({ length: 1200 }, (_, i) =>
        i % 2 === 0
          ? e("tool.completed", {
              tool: "read_file",
              target: `src/module_${i}/index.ts`,
              result: { path: `src/module_${i}/index.ts`, lineCount: 40 + (i % 60) }
            })
          : e("change.created", { path: `src/module_${i}/index.ts`, operation: "MODIFY", additions: 1 + (i % 9), deletions: i % 4 })
      ),
      ...completedTail
    ]
  }
];

export function fixtureById(id: string | null): Fixture {
  return FIXTURES.find(f => f.id === id) ?? FIXTURES[0];
}
