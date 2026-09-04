import { describe, it, expect } from "vitest";
import { TaskPlanner } from "../src/planner.js";
import { PlanValidator } from "../src/plan_validator.js";
import { PlanStateManager } from "../src/plan_state.js";
import { TaskPlan } from "@comu/protocol";

describe("Planning Engine", () => {
  const planner = new TaskPlanner();
  const validator = new PlanValidator();

  it("should generate a proportional plan for simple tasks", async () => {
    const plan = await planner.createPlan("task-1", "Rename helper function in utils.ts");
    expect(plan.steps.length).toBe(3);
    expect(plan.steps[0].type).toBe("INVESTIGATE");
    expect(plan.steps[1].type).toBe("IMPLEMENT");
    expect(plan.steps[2].type).toBe("VALIDATE");

    const valResult = validator.validate(plan);
    expect(valResult.valid).toBe(true);
    expect(valResult.errors).toHaveLength(0);
  });

  it("should generate a bug-fix remediation plan when test failures are indicated", async () => {
    const plan = await planner.createPlan("task-2", "Fix the failing tests in auth.test.ts");
    expect(plan.steps.length).toBe(5);
    expect(plan.steps.some(s => s.type === "DIAGNOSE")).toBe(true);
    expect(plan.steps.some(s => s.type === "REPAIR")).toBe(true);

    const valResult = validator.validate(plan);
    expect(valResult.valid).toBe(true);
  });

  it("should detect circular dependencies and reject the plan", () => {
    const cyclicPlan: TaskPlan = {
      planId: "plan-cycle",
      taskId: "task-cycle",
      version: 1,
      goal: "Cyclic plan",
      status: "DRAFT",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [
        {
          id: "step-1",
          type: "INVESTIGATE",
          title: "Step 1",
          description: "Step 1",
          dependencies: ["step-2"],
          status: "PENDING",
          attempts: 0
        },
        {
          id: "step-2",
          type: "IMPLEMENT",
          title: "Step 2",
          description: "Step 2",
          dependencies: ["step-1"],
          status: "PENDING",
          attempts: 0
        }
      ]
    };

    const res = validator.validate(cyclicPlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes("Circular dependency"))).toBe(true);
  });

  it("should detect missing dependencies", () => {
    const invalidPlan: TaskPlan = {
      planId: "plan-missing",
      taskId: "task-missing",
      version: 1,
      goal: "Missing dep",
      status: "DRAFT",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [
        {
          id: "step-1",
          type: "INVESTIGATE",
          title: "Step 1",
          description: "Step 1",
          dependencies: ["non-existent-step"],
          status: "PENDING",
          attempts: 0
        }
      ]
    };

    const res = validator.validate(invalidPlan);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes("non-existent dependency"))).toBe(true);
  });

  it("should track state transitions and calculate eligible steps", async () => {
    const plan = await planner.createPlan("task-3", "Implement new auth route");
    const manager = new PlanStateManager(plan, validator);

    // Initially, only step-1 has all dependencies met
    const eligible1 = manager.getEligibleSteps();
    expect(eligible1.length).toBe(1);
    expect(eligible1[0].id).toBe("step-1-investigate");

    manager.startStep("step-1-investigate");
    expect(manager.getStep("step-1-investigate")?.status).toBe("RUNNING");

    manager.completeStep("step-1-investigate", "Completed exploration");
    expect(manager.getStep("step-1-investigate")?.status).toBe("COMPLETED");

    // Next step is now eligible
    const eligible2 = manager.getEligibleSteps();
    expect(eligible2.length).toBe(1);
    expect(eligible2[0].id).toBe("step-2-implement");
  });

  it("should dynamically mutate plan after verification failure and increment version", async () => {
    const plan = await planner.createPlan("task-4", "Add API route");
    const manager = new PlanStateManager(plan, validator);

    manager.completeStep("step-1-investigate");
    manager.completeStep("step-2-implement");
    manager.startStep("step-3-validate");
    manager.failStep("step-3-validate", "Auth middleware returned 401");

    const mutatedPlan = planner.createRepairPlan(
      manager.getPlan(),
      "step-3-validate",
      "Auth middleware returned 401",
      ["src/auth.ts"]
    );

    expect(mutatedPlan.version).toBe(2);
    expect(mutatedPlan.steps.length).toBeGreaterThan(plan.steps.length);
    expect(mutatedPlan.steps.some(s => s.id.includes("step-repair-v"))).toBe(true);
    expect(validator.validate(mutatedPlan).valid).toBe(true);
  });
});
