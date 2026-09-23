import { useEffect, useState } from "react";
import type { SessionState } from "@comu/ui-state";
import { describeFailure, humanAgentState } from "@comu/ui-state";
import { Button, StatusPill, StatusTone } from "./primitives/index.js";
import styles from "./header.module.css";

function toneFor(session: SessionState): { tone: StatusTone; label: string } {
  switch (session.status) {
    case "running":
      return { tone: "running", label: humanAgentState(session.agentState) ?? "Running" };
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

const MODE_WORDS: Record<string, string> = {
  CHAT: "Chat",
  ASK: "Ask",
  PLAN: "Plan",
  AGENT: "Agent",
  AMBIGUOUS: "Needs clarifying"
};

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
 * The state, and then everything else.
 *
 * The state is the headline and carries its reason when it has one, because "Failed" on its own
 * sends a person hunting through the stream for why. The facts below it are secondary and all of
 * them are real: a model with no published price contributes no cost slot at all, rather than a
 * slot that says the cost is unknown.
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
  const reason = session.status === "failed" ? describeFailure(session.error, session.limit) : undefined;
  const mode = session.mode ? MODE_WORDS[session.mode] ?? session.mode : undefined;
  const cost = session.usage.costKnown ? session.usage.costUsd : undefined;

  // Secondary line: only the facts that exist. An empty slot beats a slot that says it is empty.
  const facts = [
    mode,
    stepLabel,
    session.timing.startedAt ? formatElapsed(elapsed) : undefined,
    session.usage.totalTokens > 0 ? `${formatTokens(session.usage.totalTokens)} tokens` : undefined,
    cost !== undefined ? `$${cost < 0.1 ? cost.toFixed(4) : cost.toFixed(2)}` : undefined
  ].filter(Boolean) as string[];

  return (
    <header className={styles.header}>
      <div className={styles.topRow}>
        <StatusPill tone={tone}>{label}</StatusPill>
        {reason ? <span className={styles.reason}>{reason}</span> : null}
        <span className={styles.spacer} />
        {running ? (
          <Button variant="ghost" small icon="stop" label="Stop the task (Esc)" onClick={onCancel} />
        ) : null}
        <Button variant="ghost" small icon="settings" label="Provider settings" onClick={onOpenSettings} />
      </div>

      {session.taskId && facts.length > 0 ? (
        <div
          className={styles.metrics}
          aria-label="Task metrics"
          title={
            session.usage.requests > 0
              ? `${session.usage.promptTokens.toLocaleString()} in, ${session.usage.completionTokens.toLocaleString()} out, over ${session.usage.requests} request(s)`
              : undefined
          }
        >
          {facts.join(" · ")}
        </div>
      ) : null}
    </header>
  );
}
