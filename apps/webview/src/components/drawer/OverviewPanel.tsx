import type { SessionState } from "@comu/ui-state";
import { Badge, EmptyState, Icon, StatusPill, StatusTone } from "../primitives/index.js";
import styles from "./drawer.module.css";

function decisionTone(approved: boolean): StatusTone {
  return approved ? "ok" : "error";
}

/** The reason codes are protocol values; these are the sentences a person reads. */
const DECISION_WORDS: Record<string, string> = {
  APPROVED: "Approved once",
  APPROVED_SESSION: "Approved for the session",
  SESSION_GRANT: "Covered by an earlier session grant",
  DENIED: "Denied",
  TIMEOUT: "Expired with no answer, so denied",
  NO_HUMAN_OBSERVER: "Nobody was watching, so denied",
  NO_INTERACTION_CHANNEL: "No way to ask, so denied"
};

/**
 * What happened, in one place.
 *
 * The header carries live status and the stream carries the reply, so this is what neither of them
 * says: why a task failed, what was diagnosed, what was repaired, and every approval decision with
 * the scope it granted. The assistant's answer is deliberately not repeated here; it is already in
 * the stream, in full, in the row it streamed into.
 *
 * The approval list is the audit trail: an automatic denial appears here exactly like a human one.
 */
export function OverviewPanel({ session }: { session: SessionState }) {
  const { diagnosis, repairs, approvals, error } = session;

  return (
    <div className={styles.panelBody}>
      {error ? (
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>
            <Icon name="error" size={12} className={styles.toneError} />
            Failed
          </h3>
          <p className={styles.blockText}>{error.message}</p>
          {error.hint ? <p className={styles.muted}>{error.hint}</p> : null}
          <p className={styles.code}>{error.code}</p>
        </section>
      ) : null}

      {diagnosis ? (
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>
            <Icon name="diagnosis" size={12} className={styles.toneWarn} />
            Diagnosis
          </h3>
          <p className={styles.blockText}>{diagnosis.summary}</p>
          <dl className={styles.facts}>
            <dt>Failure</dt>
            <dd>{diagnosis.failureType.replace(/_/g, " ").toLowerCase()}</dd>
            <dt>Confidence</dt>
            <dd>{Math.round(diagnosis.confidence * 100)}%</dd>
          </dl>
          {diagnosis.affectedFiles.length > 0 ? (
            <ul className={styles.fileList}>
              {diagnosis.affectedFiles.map(f => (
                <li key={f} className={styles.filePath} title={f}>
                  {f}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {repairs.length > 0 ? (
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>
            <Icon name="repair" size={12} />
            Repair attempts <Badge>{repairs.length}</Badge>
          </h3>
          <ul className={styles.rows}>
            {repairs.map(attempt => (
              <li key={attempt.attemptId} className={styles.row}>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    Attempt {attempt.attemptNumber}: {attempt.changeSummary || "Applied a fix"}
                  </span>
                  {attempt.outcome ? <span className={styles.rowSub}>{attempt.outcome}</span> : null}
                </span>
                <StatusPill tone={attempt.validationStatus === "PASSED" ? "ok" : "error"}>
                  {attempt.validationStatus === "PASSED" ? "Passed" : "Failed"}
                </StatusPill>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {approvals.length > 0 ? (
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>
            <Icon name="approval" size={12} />
            Approval decisions <Badge>{approvals.length}</Badge>
          </h3>
          <ul className={styles.rows}>
            {approvals.map((decision, index) => (
              <li key={`${decision.eventId}-${index}`} className={styles.row}>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{decision.summary}</span>
                  <span className={styles.rowSub}>
                    {DECISION_WORDS[decision.decision] ?? decision.decision}
                    {decision.scopeKey ? ` · ${decision.scopeKey}` : ""}
                  </span>
                </span>
                <StatusPill tone={decisionTone(decision.approved)}>
                  {decision.approved ? "Allowed" : "Refused"}
                </StatusPill>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!error && !diagnosis && repairs.length === 0 && approvals.length === 0 ? (
        <EmptyState icon="info" title="Nothing to summarise yet">
          The outcome, any diagnosis, and every approval decision appear here once the task has made
          one.
        </EmptyState>
      ) : null}
    </div>
  );
}
