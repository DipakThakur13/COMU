import { TaskPlan, PlanStep } from "@comu/protocol";
import { TaskPlannerOptions, TaskAnalysis } from "./interfaces.js";
import { PlanValidator } from "./plan_validator.js";
import { PlanStateManager } from "./plan_state.js";

export class TaskPlanner {
  private validator: PlanValidator;
  private maxSteps: number;

  constructor(options?: TaskPlannerOptions) {
    this.maxSteps = options?.maxSteps ?? 20;
    this.validator = new PlanValidator({ maxSteps: this.maxSteps });
  }

  public analyzeTask(prompt: string): TaskAnalysis {
    const lower = prompt.toLowerCase();

    // Check for feature / complex engineering
    const isComplexFeature = lower.includes("add") || lower.includes("implement") || lower.includes("refactor") || lower.includes("create");
    // Check for bug fixing / test fixing
    const isTestFix = lower.includes("fail") || lower.includes("test") || lower.includes("fix") || lower.includes("error") || lower.includes("bug");
    const isDoc = lower.includes("readme") || lower.includes("doc") || lower.includes("comment");
    const isSimpleEdit = !isComplexFeature && !isTestFix && (lower.startsWith("rename") || lower.startsWith("replace") || lower.startsWith("delete") || prompt.length < 30);

    if (isSimpleEdit) {
      return {
        complexity: "SIMPLE",
        intent: isDoc ? "DOCS" : "GENERAL",
        summary: "Targeted modification task",
        recommendedSteps: ["INVESTIGATE", "IMPLEMENT", "VALIDATE"]
      };
    }

    if (isTestFix) {
      return {
        complexity: "MEDIUM",
        intent: "FIX_BUG",
        summary: "Test repair and failure remediation task",
        recommendedSteps: ["INVESTIGATE", "VALIDATE", "DIAGNOSE", "REPAIR", "VALIDATE"]
      };
    }

    if (isComplexFeature) {
      return {
        complexity: "COMPLEX",
        intent: "ADD_FEATURE",
        summary: "Feature engineering task requiring inspection, implementation, and multi-stage verification",
        recommendedSteps: ["INVESTIGATE", "IMPLEMENT", "VALIDATE"]
      };
    }

    return {
      complexity: "MEDIUM",
      intent: "GENERAL",
      summary: "Standard engineering task",
      recommendedSteps: ["INVESTIGATE", "IMPLEMENT", "VALIDATE"]
    };
  }

  public async createPlan(taskId: string, prompt: string, signal?: AbortSignal): Promise<TaskPlan> {
    if (signal?.aborted) {
      throw new Error("Task planning was aborted.");
    }

    const analysis = this.analyzeTask(prompt);
    const now = new Date().toISOString();
    const planId = `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    let steps: PlanStep[] = [];

    if (analysis.complexity === "SIMPLE") {
      steps = [
        {
          id: "step-1-locate",
          type: "INVESTIGATE",
          title: "Locate target files",
          description: "Inspect workspace to identify exact files and symbols needing modification.",
          dependencies: [],
          status: "PENDING",
          attempts: 0
        },
        {
          id: "step-2-modify",
          type: "IMPLEMENT",
          title: "Apply required modifications",
          description: "Perform precise, bounded edits using optimistic concurrency control.",
          dependencies: ["step-1-locate"],
          status: "PENDING",
          attempts: 0
        },
        {
          id: "step-3-validate",
          type: "VALIDATE",
          title: "Validate workspace changes",
          description: "Verify that changes satisfy requirements and introduce no regressions.",
          dependencies: ["step-2-modify"],
          status: "PENDING",
          attempts: 0
        }
      ];
    } else if (analysis.intent === "FIX_BUG") {
      steps = [
        {
          id: "step-1-inspect",
          type: "INVESTIGATE",
          title: "Inspect workspace and reproduction context",
          description: "Review codebase context, configuration, and recent test failure details.",
          dependencies: [],
          status: "PENDING",
          attempts: 0
        },
        {
          id: "step-2-run-validation",
          type: "VALIDATE",
          title: "Execute initial validation checks",
          description: "Run test suite and typechecks to capture reproduction evidence.",
          dependencies: ["step-1-inspect"],
          status: "PENDING",
          attempts: 0
        },
        {
          id: "step-3-diagnose",
          type: "DIAGNOSE",
          title: "Diagnose failure root cause",
          description: "Analyze stack traces, compiler diagnostics, and affected source files.",
          dependencies: ["step-2-run-validation"],
          status: "PENDING",
          attempts: 0
        },
        {
          id: "step-4-repair",
          type: "REPAIR",
          title: "Implement targeted repair",
          description: "Modify affected source files to resolve the identified root cause.",
          dependencies: ["step-3-diagnose"],
          status: "PENDING",
          attempts: 0
        },
        {
          id: "step-5-revalidate",
          type: "VALIDATE",
          title: "Re-validate workspace and verify fix",
          description: "Execute required verification suite to confirm all checks pass.",
          dependencies: ["step-4-repair"],
          status: "PENDING",
          attempts: 0
        }
      ];
    } else {
      steps = [
        {
          id: "step-1-investigate",
          type: "INVESTIGATE",
          title: "Investigate architecture and dependencies",
          description: "Explore existing project conventions, modules, and interfaces.",
          dependencies: [],
          status: "PENDING",
          attempts: 0
        },
        {
          id: "step-2-implement",
          type: "IMPLEMENT",
          title: "Implement requested engineering changes",
          description: "Create or update source files respecting workspace constraints and conventions.",
          dependencies: ["step-1-investigate"],
          status: "PENDING",
          attempts: 0
        },
        {
          id: "step-3-validate",
          type: "VALIDATE",
          title: "Execute verification suite",
          description: "Perform authoritative typecheck, lint, build, and test verification.",
          dependencies: ["step-2-implement"],
          status: "PENDING",
          attempts: 0
        }
      ];
    }

    const plan: TaskPlan = {
      planId,
      taskId,
      version: 1,
      goal: prompt,
      steps,
      status: "READY",
      createdAt: now,
      updatedAt: now
    };

    const validation = this.validator.validate(plan);
    if (!validation.valid) {
      throw new Error(`Generated plan failed validation: ${validation.errors.join("; ")}`);
    }

    return plan;
  }

  public createRepairPlan(
    currentPlan: TaskPlan,
    failedStepId: string,
    diagnosisSummary: string,
    targetFiles: string[]
  ): TaskPlan {
    const manager = new PlanStateManager(currentPlan, this.validator);
    const repairIndex = currentPlan.version;

    const newSteps: PlanStep[] = [
      {
        id: `step-diag-v${repairIndex}`,
        type: "DIAGNOSE",
        title: `Diagnose validation failure (Attempt ${repairIndex})`,
        description: `Analyze failure evidence: ${diagnosisSummary.slice(0, 120)}`,
        dependencies: [failedStepId],
        status: "COMPLETED",
        attempts: 1,
        resultSummary: diagnosisSummary
      },
      {
        id: `step-repair-v${repairIndex}`,
        type: "REPAIR",
        title: `Apply targeted repair (Attempt ${repairIndex})`,
        description: `Modify affected files: ${targetFiles.join(", ") || "identified targets"}`,
        dependencies: [`step-diag-v${repairIndex}`],
        status: "PENDING",
        attempts: 0
      },
      {
        id: `step-revalidate-v${repairIndex}`,
        type: "VALIDATE",
        title: `Re-validate after repair (Attempt ${repairIndex})`,
        description: "Re-run authoritative verification suite to confirm resolution.",
        dependencies: [`step-repair-v${repairIndex}`],
        status: "PENDING",
        attempts: 0
      }
    ];

    return manager.injectStepsAfterFailure(
      failedStepId,
      newSteps,
      `Validation failure remediation: ${diagnosisSummary}`
    );
  }
}
