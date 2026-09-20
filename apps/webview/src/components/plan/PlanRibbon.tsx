import { useState } from "react";
import type { PlanView } from "@comu/ui-state";
import { Icon, IconName } from "../primitives/index.js";
import styles from "./plan.module.css";

const STEP_ICON: Record<string, IconName> = {
  INVESTIGATE: "search",
  IMPLEMENT: "edit",
  VALIDATE: "verification",
  DIAGNOSE: "diagnosis",
  REPAIR: "repair",
  USER_INPUT: "approval"
};

const STATUS_CLASS: Record<PlanView["steps"][number]["status"], string> = {
  PENDING: styles.pending,
  RUNNING: styles.running,
  COMPLETED: styles.completed,
  FAILED: styles.failed,
  BLOCKED: styles.blocked,
  SKIPPED: styles.skipped
};

const STATUS_ICON: Record<PlanView["steps"][number]["status"], IconName> = {
  PENDING: "dot",
  RUNNING: "sync",
  COMPLETED: "check",
  FAILED: "error",
  BLOCKED: "warning",
  SKIPPED: "dot"
};

/**
 * The plan as a collapsible strip above the stream, not a tab you have to go and find.
 *
 * Deliberately restrained. The planner is still a template selector until the planning model call
 * lands, so most plans are three similar steps; the component is built to carry richer,
 * model-authored plans with acceptance criteria without needing a redesign, but it does not dress
 * up what is currently there.
 */
export function PlanRibbon({ plan }: { plan: PlanView }) {
  const [expanded, setExpanded] = useState(false);
  const total = plan.steps.length;
  const current = plan.currentIndex >= 0 ? plan.steps[plan.currentIndex] : undefined;
  const position = plan.currentIndex >= 0 ? plan.currentIndex + 1 : total;

  return (
    <section className={styles.ribbon} aria-label="Plan">
      <button
        type="button"
        className={styles.summary}
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
      >
        <Icon name="plan" size={12} className={styles.summaryIcon} />
        <span className={styles.summaryText}>
          {current ? current.title : "Plan complete"}
        </span>
        <span className={styles.position}>
          {position}/{total}
        </span>
        <Icon name={expanded ? "chevronDown" : "chevronRight"} size={12} className={styles.summaryIcon} />
      </button>

      <ol className={styles.track} aria-hidden="true">
        {plan.steps.map(step => (
          <li key={step.id} className={`${styles.tick} ${STATUS_CLASS[step.status]}`} />
        ))}
      </ol>

      {expanded ? (
        <ol className={styles.steps}>
          {plan.steps.map((step, index) => (
            <li key={step.id} className={`${styles.step} ${STATUS_CLASS[step.status]}`}>
              <span className={styles.stepIcon}>
                <Icon name={STATUS_ICON[step.status]} size={12} spin={step.status === "RUNNING"} />
              </span>
              <span className={styles.stepBody}>
                <span className={styles.stepTitle}>
                  <span className={styles.stepNumber}>{index + 1}.</span> {step.title}
                </span>
                {step.resultSummary ? <span className={styles.stepResult}>{step.resultSummary}</span> : null}
              </span>
              <Icon name={STEP_ICON[step.type] ?? "dot"} size={11} className={styles.stepType} />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
