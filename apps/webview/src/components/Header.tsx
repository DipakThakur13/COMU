import { useEffect, useState } from "react";
import type { SessionState } from "@comu/ui-state";
import { Button, Icon, StatusPill, StatusTone } from "./primitives/index.js";
import styles from "./header.module.css";

function toneFor(session: SessionState): { tone: StatusTone; label: string } {
  switch (session.status) {
    case "running":
      return { tone: "running", label: humanState(session.agentState) };
    case "waiting_for_user":
      return { tone: "waiting", label: "Waiting for you" };
    case "cancelling":
      return { tone: "warn", label: "Cancelling" };
    case "completed":
      return { tone: "ok", label: "Completed" };
    case "failed":
      return { tone: "error", label: "Failed" };
    case "cancelled":
      return { tone: "warn", label: "Cancelled" };
    default:
      return { tone: "idle", label: "Idle" };
  }
}

function humanState(state: SessionState["agentState"]): string {
  const words: Record<string, string> = {
    STARTING: "Starting",
    CLASSIFYING: "Classifying",
    ANALYZING: "Analysing",
    PLANNING: "Planning",
    THINKING: "Thinking",
    TOOL_CALLING: "Running tools",
    OBSERVING: "Observing",
    VERIFYING: "Verifying",
    DIAGNOSING: "Diagnosing",
    REPAIRING: "Repairing",
    WAITING_FOR_USER: "Waiting for you"
  };
  return words[state] ?? "Running";
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Status, progress, elapsed time and budget burn.
 *
 * Usage comes from the provider on every request and used to be discarded. Showing what a task is
 * costing while it runs is the cheapest trust win available; when the model has no known price the
 * header shows tokens only rather than inventing a figure.
 */
export function Header({
  session,
  onCancel,
  onOpenSettings
}: {
  session: SessionState;
  onCancel: () => void;
  onOpenSettings: () => void;
}) {
  const { tone, label } = toneFor(session);
  const running = session.status === "running" || session.status === "waiting_for_user" || session.status === "cancelling";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || !session.timing.startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running, session.timing.startedAt]);

  const elapsed = session.timing.startedAt
    ? (session.timing.endedAt ?? (running ? now : session.timing.startedAt)) - session.timing.startedAt
    : 0;

  const plan = session.plan;
  const stepLabel = plan && plan.currentIndex >= 0 ? `Step ${plan.currentIndex + 1} of ${plan.steps.length}` : undefined;

  return (
    <header className={styles.header}>
      <div className={styles.topRow}>
        <StatusPill tone={tone}>{label}</StatusPill>
        {stepLabel ? <span className={styles.step}>{stepLabel}</span> : null}
        <span className={styles.spacer} />
        {running ? (
          <Button variant="ghost" small icon="stop" label="Stop the task (Esc)" onClick={onCancel} />
        ) : null}
        <Button variant="ghost" small icon="settings" label="Provider settings" onClick={onOpenSettings} />
      </div>

      {session.taskId ? (
        <div className={styles.metrics} aria-label="Task metrics">
          <span className={styles.metric} title="Elapsed time, excluding time spent waiting for you">
            <Icon name="history" size={11} />
            {formatElapsed(elapsed)}
          </span>
          <span className={styles.metric} title={`${session.usage.promptTokens.toLocaleString()} in, ${session.usage.completionTokens.toLocaleString()} out, over ${session.usage.requests} request(s)`}>
            <Icon name="agent" size={11} />
            {formatTokens(session.usage.totalTokens)} tokens
          </span>
          {session.usage.costKnown && session.usage.costUsd !== undefined ? (
            <span className={styles.metric} title="Estimated from the model's published price">
              ${session.usage.costUsd < 0.1 ? session.usage.costUsd.toFixed(4) : session.usage.costUsd.toFixed(2)}
            </span>
          ) : session.usage.requests > 0 ? (
            <span className={`${styles.metric} ${styles.muted}`} title="This model has no published price, so COMU does not estimate a cost">
              cost unknown
            </span>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
