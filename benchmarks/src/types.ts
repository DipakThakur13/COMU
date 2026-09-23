/**
 * The benchmark's vocabulary.
 *
 * A fixture is a pinned source tree, a prompt, and a way of deciding afterwards whether the work
 * was actually done. The deciding is the part that matters: every grader here reaches its verdict
 * by running the code, never by reading what COMU said about itself.
 */

export type Tier = "T1" | "T2" | "T3" | "T4" | "T7";

export const TIER_NAMES: Record<Tier, string> = {
  T1: "single file bug fix",
  T2: "feature addition",
  T3: "multi file refactor",
  T4: "failing test debug",
  T7: "unfamiliar repo onboarding"
};

export type Ecosystem = "typescript" | "python";

/** A command run inside the fixture workspace. Never a shell string; always an argument vector. */
export interface Command {
  executable: string;
  args: string[];
}

/**
 * Runs the fixture's test suite and compares the result against the same suite before the agent
 * touched anything. Both ecosystems emit JUnit XML, which is why it is the interchange format:
 * `vitest --reporter=junit` and `pytest --junit-xml` produce the same shape.
 */
export interface TestsGrader {
  kind: "tests";
  /** Must exit zero for the task to count as correct. */
  command: Command;
  /** Where the command writes its JUnit XML, relative to the workspace. */
  junitPath: string;
  /**
   * Test names that fail before the agent runs and must pass after. Empty means "the suite was
   * already green and must stay green", which is the shape T2 and T3 use.
   */
  mustPass?: string[];
}

/**
 * A rename or extraction. Passing the test suite is necessary but not sufficient: a refactor that
 * leaves the old name behind has not been done, and one that rewrites half the repository has been
 * done too enthusiastically.
 */
export interface RefactorGrader {
  kind: "refactor";
  tests: TestsGrader;
  /** Strings that must appear nowhere in the workspace sources afterwards. */
  forbidden: string[];
  /** Files that must exist and contain each of the given strings. */
  required: Array<{ path: string; contains: string[] }>;
}

/**
 * Grades an answer rather than a change, for the onboarding tier.
 *
 * Deterministic on purpose. A model judge would make the benchmark's own verdict depend on a model,
 * which is the thing under measurement, and would cost a second inference per run. Each point is a
 * fact the answer has to contain, matched by any one of several patterns so that wording is free.
 */
export interface RubricGrader {
  kind: "rubric";
  points: Array<{
    id: string;
    /** What the answer has to convey. Documentation for whoever reads a failure. */
    description: string;
    /** Case-insensitive regular expressions; matching any one scores the point. */
    anyOf: string[];
  }>;
  /** Fraction of points needed to count as correct. */
  passThreshold: number;
}

export type GraderSpec = TestsGrader | RefactorGrader | RubricGrader;

/** Optional per-fixture setup, run once before the agent starts. */
export interface FixtureSetup {
  /** Commands run in the workspace, for example installing pinned Python dependencies. */
  commands?: Command[];
}

export interface FixtureSpec {
  id: string;
  tier: Tier;
  ecosystem: Ecosystem;
  /** One sentence on what the fixture is for, shown in the report. */
  description: string;
  /** The task given to COMU, verbatim. */
  prompt: string;
  mode?: "AUTO" | "AGENT" | "ASK" | "PLAN" | "CHAT";
  autonomy?: "readonly" | "ask" | "auto";
  /** Budget override for this fixture. Recorded with the result. */
  limits?: Record<string, number>;
  setup?: FixtureSetup;
  grader: GraderSpec;
  /**
   * Paths the golden solution touches. Anything the agent changes outside this set counts as an
   * unnecessary change. Directory prefixes end with a slash.
   */
  allowedPaths: string[];
  /**
   * Deliberately present defects or oddities, so a reader of a failure knows what was intended.
   * Never shown to the agent.
   */
  notes?: string;
}

export const FAILURE_CLASSES = [
  "context_overflow",
  "planning_miss",
  "tool_error_unrecovered",
  "verification_unavailable",
  "gate_misfire",
  "loop_truncation",
  "unnecessary_changes",
  "regression_introduced",
  "provider_error",
  "grader_failed_other"
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

export interface ProviderFailureCounts {
  /** A request that passed modelRequestTimeoutMs. Under concurrency this is usually contention. */
  timeouts: number;
  /** 429. The measurement is asking for more than the account is allowed. */
  rateLimits: number;
  /** 502, 503 and 504: the provider's front door, which correlates with request size. */
  gateway: number;
  /** Everything else the provider refused. */
  other: number;
}

/**
 * Sorts a provider failure by cause.
 *
 * Order matters. A timeout is raised by COMU itself and carries no HTTP status, so it has to be
 * matched first or it would fall through to "other" and hide the one cause the benchmark is
 * capable of creating for itself.
 */
export function classifyProviderFailure(text: string): keyof ProviderFailureCounts {
  if (/timed out after/i.test(text)) return "timeouts";
  if (/(^|[^0-9])429([^0-9]|$)/.test(text) || /rate limit/i.test(text)) return "rateLimits";
  if (/(^|[^0-9])(502|503|504)([^0-9]|$)/.test(text)) return "gateway";
  return "other";
}

/**
 * Whether the harness lost its connection to the run, rather than the run ending.
 *
 * A stream severed under a refusing gateway surfaces as fetch's own error ("terminated", "fetch
 * failed", a socket reset), recorded as a harness error with no provider failure counted, because
 * no provider event ever arrived. It is still the provider's doing, not the agent's. The harness's
 * own wall-clock timeout is deliberately not included: that one is a budget, not a dropped line.
 */
export function droppedConnection(record: { harnessError?: string }): boolean {
  const error = record.harnessError ?? "";
  return /^(terminated|fetch failed|other side closed|socket hang up)\b|ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR_SOCKET/i.test(error);
}


export interface GraderVerdict {
  correct: boolean;
  /** Why, in words, for whoever reads the result file. */
  reason: string;
  /** Tests that passed before the agent ran and fail afterwards. */
  regressions: string[];
  /** Tests that were required to pass and still do not. */
  stillFailing: string[];
  /** Rubric points scored, for the onboarding tier. */
  rubric?: { scored: string[]; missed: string[]; fraction: number };
}

export interface RunRecord {
  fixtureId: string;
  tier: Tier;
  ecosystem: Ecosystem;
  rep: number;
  model: { id: string; provider: string };
  limits: Record<string, number>;
  startedAt: string;
  durationMs: number;
  /**
   * How many runs were in flight when this one was measured.
   *
   * Per record rather than per run, because a long measurement can be resumed at a different level
   * after contention is found to be reaching the results. Without it a mixed journal cannot say
   * which durations are real and which are upper bounds.
   */
  concurrency: number;

  /** What COMU said about itself. Never used to decide correctness. */
  comuStatus: string;
  /**
   * COMU's own reason for ending, when it did not end cleanly.
   *
   * A false failure is only actionable with the cause attached: "the agent said it failed" is not a
   * finding, "the agent said LIMIT_REACHED after 30 steps and the work was already correct" is.
   */
  comuError: string;
  /**
   * The agent's final message, verbatim and bounded.
   *
   * Recorded so a human can spot check the quality of an onboarding answer without the score
   * depending on that reading. The rubric grade stays deterministic; this is for the reader.
   */
  finalAnswer: string;
  /** What running the code says. */
  grader: GraderVerdict;

  /** COMU claimed success and the grader disagrees. The outcome that destroys trust. */
  falseCompletion: boolean;
  /** COMU claimed failure and the work was correct. Usually a verification or gate defect. */
  falseFailure: boolean;

  unnecessaryChanges: string[];
  filesChanged: string[];

  approvalsRequested: number;
  clarificationsRequested: number;
  toolCalls: number;
  modelRequests: number;
  promptTokens: number;
  completionTokens: number;
  /** Largest single prompt, from provider-reported usage. No tokeniser needed to observe it. */
  peakPromptTokens: number;
  contextWindow: number;
  /** peakPromptTokens / contextWindow. Keeps the context trend visible without an overflow. */
  peakContextRatio: number;

  /** Why the provider rejected a request, counted by cause: timeouts, rate limits, gateway, other. */
  providerFailures: ProviderFailureCounts;

  planSteps: number;
  planVersions: number;
  repairAttempts: number;
  repairRecovered: boolean;
  verificationStatus?: string;

  failureClass: FailureClass | null;
  /** Anything the harness itself could not do, as opposed to anything COMU did wrong. */
  harnessError?: string;
}

export interface BenchmarkRun {
  label: string;
  startedAt: string;
  finishedAt: string;
  /** Present only for a real measurement; a self test refuses to produce one. */
  model: { id: string; provider: string };
  gitCommit: string;
  reps: number;
  /**
   * How many runs executed at once.
   *
   * Recorded because it changes how one metric should be read: concurrent runs contend for the
   * provider, so wall clock becomes an upper bound. Correctness, tokens, failure classes and peak
   * context are unaffected, since every run has its own runtime and its own workspace.
   */
  concurrency: number;
  records: RunRecord[];
  /** Present when a resume was allowed to change the budget, so the result says it is mixed. */
  mixedLimits?: MixedLimitsMarker[];
  /** Corrections and caveats established after the records were written. See RunAnnotations. */
  annotations?: RunAnnotations;
}

/**
 * What became known about a run after its records were written, kept beside its journal as
 * `<label>.annotations.json` and applied every time the run is rendered.
 *
 * The journal is not edited: it is the audit trail of what the harness believed at the time. A
 * hand-edited result file would be lost the next time the run is re-rendered, which a run needs
 * whenever the reading of its records improves.
 */
export interface RunAnnotations {
  /**
   * The model that actually served the run, when it is not the one the run was launched naming.
   * B0 was launched naming Ultra 550B, and every request went to Lightning 30B-A3B.
   */
  servedModel?: { id: string; provider: string; launchedAs: string; reason: string };
  /** Anything the numbers cannot show about themselves, stated once at the top of the report. */
  limitations?: string[];
}

/** One limit a resumed run would measure under differently from the records already in the journal. */
export interface LimitDifference {
  fixtureId: string;
  key: string;
  recorded?: number;
  incoming?: number;
}

/**
 * A journal line that is not a record: a resume went ahead under a different budget.
 *
 * Written into the journal itself rather than beside it, because the journal is the result and a
 * separate file can be lost or not copied with it.
 */
export interface MixedLimitsMarker {
  journalEvent: "mixed_limits";
  acceptedAt: string;
  differences: LimitDifference[];
}
