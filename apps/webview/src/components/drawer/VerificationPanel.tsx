import type { VerificationCheck, VerificationResult } from "@comu/protocol";
import { Badge, EmptyState, Icon, StatusPill, StatusTone } from "../primitives/index.js";
import styles from "./drawer.module.css";

const RESULT_TONE: Record<VerificationResult["status"], StatusTone> = {
  PASSED: "ok",
  FAILED: "error",
  PARTIAL: "warn",
  UNAVAILABLE: "idle",
  // Nothing checked is evidence of the change: never green.
  NOT_VERIFIED: "warn"
};

const RESULT_WORDS: Record<VerificationResult["status"], string> = {
  PASSED: "Passed",
  FAILED: "Failed",
  PARTIAL: "Partly passed",
  UNAVAILABLE: "Could not run",
  NOT_VERIFIED: "Not verified"
};

function checkIcon(status: VerificationCheck["status"]): { name: "check" | "error" | "dot"; className: string } {
  if (status === "PASSED") return { name: "check", className: styles.toneOk };
  if (status === "FAILED") return { name: "error", className: styles.toneError };
  return { name: "dot", className: styles.toneMuted };
}

/**
 * What was checked and what it said.
 *
 * Failed checks sort first, because the reason to open this panel is almost always a failure, and
 * scrolling past thirty passing checks to find it is the whole problem with a flat list. A check
 * that did not run says why rather than rendering as a neutral blank: "unavailable" and "passed"
 * must never look alike.
 */
export function VerificationPanel({ result }: { result: VerificationResult }) {
  const order = { FAILED: 0, PASSED: 2 } as Record<string, number>;
  const checks = [...result.checks].sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1));
  const passed = result.checks.filter(c => c.status === "PASSED").length;

  return (
    <div className={styles.panelBody}>
      <section className={styles.block}>
        <h3 className={styles.blockTitle}>
          <StatusPill tone={RESULT_TONE[result.status]}>{RESULT_WORDS[result.status]}</StatusPill>
          <span className={styles.muted}>
            {passed} of {result.checks.length} checks passed
          </span>
        </h3>
        {result.summary ? <p className={styles.blockText}>{result.summary}</p> : null}
      </section>

      {checks.length === 0 ? (
        <EmptyState icon="verification" title="No checks were run">
          This verification reported no individual checks.
        </EmptyState>
      ) : (
        <ul className={styles.rows} aria-label="Verification checks">
          {checks.map(check => {
            const icon = checkIcon(check.status);
            const detail = check.skipReason ?? check.details;
            return (
              <li key={check.id} className={styles.row}>
                <Icon name={icon.name} size={12} className={icon.className} />
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    {check.name}
                    {check.required ? null : <span className={styles.optional}> optional</span>}
                  </span>
                  {check.command ? <code className={styles.rowCommand}>{check.command}</code> : null}
                  {detail ? <span className={styles.rowSub}>{detail}</span> : null}
                </span>
                {check.exitCode !== undefined && check.exitCode !== 0 ? (
                  <Badge title="Process exit code">exit {check.exitCode}</Badge>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
