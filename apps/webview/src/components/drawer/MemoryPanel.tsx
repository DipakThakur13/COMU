import type { MemoryTrustLevel, WorkspaceMemoryEntry } from "@comu/protocol";
import { Badge, EmptyState, Icon } from "../primitives/index.js";
import styles from "./drawer.module.css";

/**
 * Trust is the only thing that makes a memory list safe to read.
 *
 * A convention the user stated and a guess the model derived are both "memory", and acting on them
 * carries very different risk. Each entry says which it is, in words, rather than leaving the
 * reader to infer it from a colour.
 */
const TRUST_WORDS: Record<MemoryTrustLevel, string> = {
  USER_VERIFIED: "You confirmed this",
  VERIFIED_EVIDENCE: "Backed by evidence",
  TASK_VERIFIED: "Held true in a completed task",
  AGENT_DERIVED: "Inferred by COMU",
  UNVERIFIED: "Unverified"
};

const TRUST_CLASS: Record<MemoryTrustLevel, string> = {
  USER_VERIFIED: styles.trustHigh,
  VERIFIED_EVIDENCE: styles.trustHigh,
  TASK_VERIFIED: styles.trustMid,
  AGENT_DERIVED: styles.trustLow,
  UNVERIFIED: styles.trustLow
};

const TYPE_WORDS: Record<WorkspaceMemoryEntry["type"], string> = {
  CONVENTION: "Convention",
  LESSON: "Lesson",
  EPISODE: "Episode"
};

const TRUST_ORDER: MemoryTrustLevel[] = [
  "USER_VERIFIED",
  "VERIFIED_EVIDENCE",
  "TASK_VERIFIED",
  "AGENT_DERIVED",
  "UNVERIFIED"
];

/**
 * What COMU believes about this workspace.
 *
 * Read only. Nothing here edits or deletes a memory, because the engine has no such operation and
 * a button that silently does nothing is worse than no button. Stale and invalidated entries are
 * shown rather than hidden: if COMU is still carrying a belief, the user should be able to see it.
 */
export function MemoryPanel({ entries }: { entries: WorkspaceMemoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className={styles.panelBody}>
        <EmptyState icon="memory" title="Nothing remembered yet">
          Conventions and lessons COMU has learned about this workspace appear here.
        </EmptyState>
      </div>
    );
  }

  const sorted = [...entries].sort(
    (a, b) => TRUST_ORDER.indexOf(a.trustLevel) - TRUST_ORDER.indexOf(b.trustLevel)
  );

  return (
    <div className={styles.panelBody}>
      <ul className={styles.rows} aria-label="Workspace memory">
        {sorted.map(entry => (
          <li key={entry.id} className={styles.row}>
            <span className={styles.rowMain}>
              <span className={styles.rowMeta}>
                <Badge>{TYPE_WORDS[entry.type]}</Badge>
                <span className={`${styles.trust} ${TRUST_CLASS[entry.trustLevel]}`}>
                  {TRUST_WORDS[entry.trustLevel]}
                </span>
                {entry.status !== "ACTIVE" ? (
                  <span className={styles.staleTag} title="COMU no longer relies on this">
                    <Icon name="warning" size={10} />
                    {entry.status === "STALE" ? "stale" : "invalidated"}
                  </span>
                ) : null}
              </span>
              <span className={styles.rowTitle}>{entry.content}</span>
              {entry.scope.files && entry.scope.files.length > 0 ? (
                <span className={styles.rowSub}>{entry.scope.files.join(", ")}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
