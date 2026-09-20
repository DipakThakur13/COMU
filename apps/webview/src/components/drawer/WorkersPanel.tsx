import type { WorkerView } from "@comu/ui-state";
import { EmptyState, StatusPill, StatusTone } from "../primitives/index.js";
import styles from "./drawer.module.css";

const STATUS_TONE: Record<WorkerView["status"], StatusTone> = {
  RUNNING: "running",
  COMPLETED: "ok",
  FAILED: "error",
  CANCELLED: "warn",
  LIMIT_REACHED: "warn"
};

const STATUS_WORDS: Record<WorkerView["status"], string> = {
  RUNNING: "Running",
  COMPLETED: "Done",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  LIMIT_REACHED: "Hit its limit"
};

/**
 * Background workers.
 *
 * A worker's live text stays here and never enters the main stream. Two agents writing into one
 * transcript produces something no one can read, and the main stream belongs to the task the user
 * asked for.
 */
export function WorkersPanel({ workers }: { workers: WorkerView[] }) {
  if (workers.length === 0) {
    return (
      <div className={styles.panelBody}>
        <EmptyState icon="worker" title="No workers running">
          When COMU delegates part of a task, each worker appears here with its own progress.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className={styles.panelBody}>
      <ul className={styles.rows} aria-label="Background workers">
        {workers.map(worker => (
          <li key={worker.subagentId} className={styles.row}>
            <span className={styles.rowMain}>
              <span className={styles.rowMeta}>
                <span className={styles.rowTitle}>{worker.subagentType}</span>
                <StatusPill tone={STATUS_TONE[worker.status]}>{STATUS_WORDS[worker.status]}</StatusPill>
              </span>
              {worker.goal ? <span className={styles.rowSub}>{worker.goal}</span> : null}
              {worker.summary ? <span className={styles.rowText}>{worker.summary}</span> : null}
              {worker.status === "RUNNING" && worker.streamText ? (
                <span className={styles.workerStream} aria-live="polite">
                  {worker.streamText}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
