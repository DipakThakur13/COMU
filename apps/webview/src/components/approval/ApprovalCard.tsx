import { useEffect, useRef, useState } from "react";
import type { InteractionResponse } from "@comu/protocol";
import type { ApprovalView } from "@comu/ui-state";
import { Button, Icon } from "../primitives/index.js";
import { DiffView } from "../diff/DiffView.js";
import styles from "./approval.module.css";

/** Which grant is the obvious one, which is quieter, and which needs asking twice. */
type ScopeWeight = "primary" | "secondary" | "confirm";

function weighScope(key: string): ScopeWeight {
  if (key.startsWith("file:")) return "primary";
  if (key === "writes:*" || key === "dir:/") return "confirm";
  return "secondary";
}

function scopeShortLabel(key: string): string {
  if (key.startsWith("file:")) return "this file";
  if (key === "writes:*") return "all writes";
  if (key.startsWith("dir:")) return `everything in ${key.slice(4)}`;
  if (key.startsWith("cmd:")) return "this exact command";
  return key;
}

function secondsLeft(expiresAt: string, now: number): number {
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((deadline - now) / 1000));
}

function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

export interface ApprovalCardProps {
  approval: ApprovalView;
  onRespond: (response: InteractionResponse) => void;
}

/**
 * The centrepiece: a decision a person can actually make.
 *
 * Shows the change that will land, not the fact that a tool wants to run. Safety properties are
 * deliberate, not incidental:
 *  - focus lands on the card itself, never on Approve, so a stray Enter approves nothing
 *  - Deny is always present and always reachable, and says what denying does
 *  - the broadest grant ("all writes") asks a second time; the narrowest is the obvious button
 *  - every grant shows the exact session scope key it will create
 *  - expiry is stated in words, because a silent timeout that denies would be baffling
 *  - a push is marked as unconditional and offers no session grant at all
 */
export function ApprovalCard({ approval, onRespond }: ApprovalCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState<string>();

  const payload = approval.payload;
  const isPush = payload?.kind === "git_push";
  const remaining = secondsLeft(approval.expiresAt, now);
  const expired = remaining === 0;
  const urgent = Number.isFinite(remaining) && remaining <= 60;

  // Focus the card, not a control inside it: the person is oriented without any key press being
  // one stray Enter away from approving a write.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: false });
  }, [approval.interactionId]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [approval.interactionId]);

  useEffect(() => setConfirming(undefined), [approval.interactionId]);

  const scopes = payload?.scopes ?? [];

  return (
    <div
      ref={cardRef}
      className={`${styles.card} ${isPush ? styles.pushCard : ""}`}
      tabIndex={-1}
      role="group"
      aria-labelledby={`approval-title-${approval.interactionId}`}
    >
      <div className={styles.head}>
        <Icon name={isPush ? "git" : "approval"} size={13} className={styles.headIcon} />
        <p className={styles.kind}>{isPush ? "Push approval required" : "Approval required"}</p>
        {Number.isFinite(remaining) ? (
          <span className={`${styles.countdown} ${urgent ? styles.countdownUrgent : ""}`} role="timer" aria-live="off">
            {expired ? "expired" : formatCountdown(remaining)}
          </span>
        ) : null}
      </div>

      <p className={styles.title} id={`approval-title-${approval.interactionId}`}>
        {payload?.summary ?? approval.title}
      </p>

      {isPush ? (
        <p className={styles.pushNote}>
          Pushing sends your commits to a remote. A person approves every push, in every autonomy
          level, and it can never be granted for the session.
        </p>
      ) : null}

      {payload?.file ? (
        <>
          <p className={styles.path}>
            <Icon name={payload.file.operation === "CREATE" ? "create" : "edit"} size={12} />
            <span className={styles.pathText}>{payload.file.path}</span>
            <span className={styles.counts}>
              <span className={styles.add}>+{payload.file.additions}</span>
              <span className={styles.del}>-{payload.file.deletions}</span>
            </span>
          </p>
          {payload.file.note ? <p className={styles.warn}>{payload.file.note}</p> : null}
          <DiffView
            path={payload.file.path}
            diff={payload.file.diff}
            content={payload.file.content}
            operation={payload.file.operation}
            truncated={payload.file.truncated}
          />
        </>
      ) : null}

      {payload?.command ? (
        <div className={styles.commandBlock}>
          <p className={styles.path}>
            <Icon name="terminal" size={12} />
            <span className={styles.pathText}>{payload.command.cwd}</span>
          </p>
          <ol className={styles.argv} aria-label="Command and arguments">
            <li className={styles.executable}>{payload.command.executable}</li>
            {payload.command.args.map((arg, index) => (
              <li key={`${index}-${arg}`} className={styles.arg}>
                {arg}
              </li>
            ))}
          </ol>
          <p className={styles.hint}>
            Run directly with no shell, so this is the exact argument list. Nothing is expanded or
            re-parsed.
          </p>
        </div>
      ) : null}

      {!payload?.file && !payload?.command && payload?.details ? (
        <pre className={styles.details}>{JSON.stringify(payload.details, null, 2)}</pre>
      ) : null}

      <div className={styles.actions}>
        <Button variant="primary" icon="check" onClick={() => onRespond({ type: "APPROVE" })} disabled={expired}>
          Approve once
        </Button>
        <Button variant="danger" icon="close" onClick={() => onRespond({ type: "DENY" })}>
          Deny
        </Button>
      </div>

      <p className={styles.denyNote}>
        Denying is safe: the agent is told and can try another approach.{" "}
        {Number.isFinite(remaining)
          ? expired
            ? "This request expired, which counts as denied."
            : "If nothing is decided before the timer runs out, it counts as denied."
          : null}
      </p>

      {scopes.length > 0 ? (
        <div className={styles.scopes}>
          <p className={styles.scopesTitle}>Or approve without asking again for the rest of this task</p>
          {scopes.map(scope => {
            const weight = weighScope(scope.key);
            const isConfirming = confirming === scope.key;
            return (
              <div key={scope.key} className={styles.scopeRow}>
                {isConfirming ? (
                  <div className={styles.confirmRow} role="group" aria-label={`Confirm ${scopeShortLabel(scope.key)}`}>
                    <span className={styles.confirmText}>
                      Allow every write for the rest of this task, without asking?
                    </span>
                    <Button
                      variant="danger"
                      small
                      onClick={() => onRespond({ type: "APPROVE_SESSION", scopeKey: scope.key })}
                      disabled={expired}
                    >
                      Yes, allow all writes
                    </Button>
                    <Button variant="ghost" small onClick={() => setConfirming(undefined)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`${styles.scopeButton} ${styles[weight]}`}
                    disabled={expired}
                    onClick={() =>
                      weight === "confirm"
                        ? setConfirming(scope.key)
                        : onRespond({ type: "APPROVE_SESSION", scopeKey: scope.key })
                    }
                  >
                    <span className={styles.scopeLabel}>
                      {weight === "confirm" ? <Icon name="warning" size={11} /> : null}
                      Approve {scopeShortLabel(scope.key)}
                    </span>
                    <code className={styles.scopeKey} title="The session grant this creates">
                      {scope.key}
                    </code>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
