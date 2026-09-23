import { memo } from "react";
import type { ActivityEntry, ActivityItem, ActivityStatus, ToolCategory } from "@comu/ui-state";
import { isActivityGroup } from "@comu/ui-state";
import { Icon, IconName } from "../primitives/index.js";
import { MessageText } from "./MessageText.js";
import styles from "./activity.module.css";

const TOOL_ICON: Record<ToolCategory, IconName> = {
  Read: "file",
  Explore: "folder",
  Search: "search",
  Edit: "edit",
  Write: "edit",
  Create: "create",
  Terminal: "terminal",
  Git: "git",
  Verification: "verification",
  Diagnosis: "diagnosis",
  Repair: "repair",
  Worker: "worker",
  Generic: "dot"
};

const STATUS_CLASS: Record<ActivityStatus, string> = {
  completed: styles.statusOk,
  active: styles.statusRunning,
  pending: styles.statusWaiting,
  warning: styles.statusWarn,
  failed: styles.statusError
};

const OUTCOME_ICON: Record<ActivityStatus, IconName> = {
  completed: "check",
  active: "sync",
  pending: "approval",
  warning: "warning",
  failed: "error"
};

function iconFor(entry: ActivityEntry): IconName {
  if (entry.level === "outcome") return OUTCOME_ICON[entry.status];
  if (entry.category === "APPROVAL") return "approval";
  if (entry.category === "AGENT_MESSAGE") return "agent";
  if (entry.toolCategory) return TOOL_ICON[entry.toolCategory];
  if (entry.category === "VALIDATION") return "verification";
  if (entry.category === "DIAGNOSIS") return "diagnosis";
  if (entry.category === "REPAIR") return "repair";
  if (entry.category === "COMMAND_OUTPUT") return "terminal";
  return "dot";
}

/**
 * Colour means one thing: this went wrong, or this went right.
 *
 * Routine work is default foreground however it is categorised, so a run of reads cannot compete
 * with a failed command for attention. Nothing here is coloured for decoration.
 */
function toneClass(entry: ActivityEntry): string {
  if (entry.status === "failed" || entry.status === "warning" || entry.status === "pending") {
    return STATUS_CLASS[entry.status];
  }
  if (entry.status === "active") return STATUS_CLASS.active;
  if (entry.level === "routine") return styles.statusMuted;
  if (entry.category === "VALIDATION") return STATUS_CLASS.completed;
  return styles.statusMuted;
}

export interface ActivityRowProps {
  entry: ActivityEntry;
  expanded: boolean;
  onToggle: (id: string) => void;
  onSaveCode?: (content: string, suggestedPath: string) => void;
  onOpenFile?: (path: string) => void;
  /** Opens the host's diff view for a written file. Undefined in surfaces that cannot show one. */
  onRequestDiff?: (path: string) => void;
}

/**
 * One row in the stream.
 *
 * Three shapes, one per hierarchy level: an outcome is a bordered block with its reason in plain
 * language, substance is a normal row with an icon that means something and a measurement on the
 * right, and routine is dimmed and compact. Memoised on identity, so appending an event does not
 * re-render the history above it.
 */
export const ActivityRow = memo(function ActivityRow({
  entry,
  expanded,
  onToggle,
  onSaveCode,
  onOpenFile,
  onRequestDiff
}: ActivityRowProps) {
  if (entry.category === "AGENT_MESSAGE") {
    return <MessageRow entry={entry as ActivityItem} onSaveCode={onSaveCode} />;
  }
  if (entry.level === "outcome") {
    return <OutcomeRow entry={entry as ActivityItem} />;
  }

  const group = isActivityGroup(entry);
  const detail = detailOf(entry);
  const expandable = group || !!detail;

  return (
    <div className={styles.row} data-level={entry.level} data-status={entry.status}>
      <button
        type="button"
        className={styles.rowHeader}
        onClick={expandable ? () => onToggle(entry.id) : undefined}
        aria-expanded={expandable ? expanded : undefined}
        disabled={!expandable}
      >
        <span className={`${styles.rowIcon} ${toneClass(entry)}`}>
          <Icon name={iconFor(entry)} size={entry.level === "routine" ? 12 : 14} spin={entry.status === "active"} />
        </span>
        <span className={styles.rowTitle}>{entry.title}</span>
        {entry.metric ? <span className={`${styles.rowMetric} ${toneClass(entry)}`}>{entry.metric}</span> : null}
        {expandable ? <Icon name={expanded ? "chevronDown" : "chevronRight"} size={12} className={styles.rowChevron} /> : null}
      </button>

      {expanded && group ? (
        <ul className={styles.groupList}>
          {entry.items.map(item => (
            <li key={item.id} className={styles.groupItem}>
              <Subject item={item} onOpenFile={onOpenFile} />
            </li>
          ))}
        </ul>
      ) : null}

      {expanded && !group ? (
        <RowDetail entry={entry as ActivityItem} onOpenFile={onOpenFile} onRequestDiff={onRequestDiff} />
      ) : null}
    </div>
  );
});

/**
 * The outcome of the task, which is the row the eye should land on first.
 *
 * Full width and bordered, with the reason written as a sentence rather than as the error code the
 * runtime used. The code is still there for anyone who needs to quote it.
 */
function OutcomeRow({ entry }: { entry: ActivityItem }) {
  return (
    <div
      className={styles.outcome}
      data-level="outcome"
      data-status={entry.status}
      role={entry.status === "failed" ? "alert" : undefined}
    >
      <span className={`${styles.outcomeIcon} ${STATUS_CLASS[entry.status]}`}>
        <Icon name={OUTCOME_ICON[entry.status]} size={14} />
      </span>
      <span className={styles.outcomeBody}>
        <span className={styles.outcomeTitle}>{entry.title}</span>
        {entry.shortDescription ? <span className={styles.outcomeReason}>{entry.shortDescription}</span> : null}
      </span>
    </div>
  );
}

/**
 * The assistant's prose, in full.
 *
 * Never clamped and never repeated: the row the reply streamed into is the row it stays in, which
 * is why there is no separate result panel anywhere in the interface.
 */
function MessageRow({ entry, onSaveCode }: { entry: ActivityItem; onSaveCode?: (content: string, suggestedPath: string) => void }) {
  const reasoning = (entry.details as { reasoning?: string } | undefined)?.reasoning;
  return (
    <div className={`${styles.row} ${styles.rowMessage}`} data-level="substance" data-status={entry.status}>
      <div className={styles.messageFull}>
        <MessageText text={entry.shortDescription ?? ""} onSaveCode={onSaveCode} />
      </div>
      {reasoning ? (
        <details className={styles.reasoning}>
          <summary>Reasoning</summary>
          <p>{reasoning}</p>
        </details>
      ) : null}
    </div>
  );
}

/** One member of a folded run: the file or query it was about, clickable when it is a file. */
function Subject({ item, onOpenFile }: { item: ActivityItem; onOpenFile?: (path: string) => void }) {
  const details = item.details as { path?: string; query?: string } | undefined;
  const path = details?.path;
  if (path && onOpenFile) {
    return (
      <button type="button" className={styles.groupItemLink} title={path} onClick={() => onOpenFile(path)}>
        {path}
      </button>
    );
  }
  return <span className={styles.groupItemText}>{path || details?.query || item.shortDescription || item.title}</span>;
}

/** Whether a row has anything to show when opened, and what. */
function detailOf(entry: ActivityEntry): "output" | "checks" | "matches" | "text" | undefined {
  if (isActivityGroup(entry)) return undefined;
  const details = entry.details as Record<string, unknown> | undefined;
  if (entry.category === "COMMAND_OUTPUT" && (details?.stdout || details?.stderr)) return "output";
  if (entry.category === "VALIDATION" && Array.isArray(details?.checks) && (details?.checks as unknown[]).length > 0) return "checks";
  if (Array.isArray(details?.matches) && (details?.matches as unknown[]).length > 0) return "matches";
  if (entry.shortDescription) return "text";
  return undefined;
}

function RowDetail({
  entry,
  onOpenFile,
  onRequestDiff
}: {
  entry: ActivityItem;
  onOpenFile?: (path: string) => void;
  onRequestDiff?: (path: string) => void;
}) {
  const details = entry.details as Record<string, any> | undefined;
  const kind = detailOf(entry);

  // A written file: the change itself is what there is to see, and the host owns the diff view.
  if (entry.category === "TOOL_ACTIVITY" && (entry.toolCategory === "Edit" || entry.toolCategory === "Create")) {
    const path = details?.path as string | undefined;
    return (
      <p className={styles.rowDetail}>
        {path && onOpenFile ? (
          <button type="button" className={styles.groupItemLink} title={path} onClick={() => onOpenFile(path)}>
            {path}
          </button>
        ) : (
          entry.shortDescription
        )}
        {path && onRequestDiff ? (
          <button type="button" className={styles.detailAction} onClick={() => onRequestDiff(path)}>
            <Icon name="diff" size={11} />
            Show the diff
          </button>
        ) : null}
      </p>
    );
  }

  if (kind === "output") {
    return (
      <div className={styles.rowDetailBlock}>
        {typeof details?.exitCode === "number" ? <p className={styles.rowDetailMeta}>Exit code {details.exitCode}</p> : null}
        {details?.stdout ? <pre className={styles.outputPre}>{String(details.stdout)}</pre> : null}
        {details?.stderr ? <pre className={`${styles.outputPre} ${styles.statusError}`}>{String(details.stderr)}</pre> : null}
      </div>
    );
  }

  if (kind === "checks") {
    return (
      <ul className={styles.checkList}>
        {(details?.checks as Array<{ id?: string; name: string; status: string; details?: string }>).map((check, index) => (
          <li key={check.id ?? `${check.name}-${index}`} className={styles.checkItem}>
            <Icon
              name={check.status === "PASSED" ? "check" : check.status === "FAILED" ? "error" : "dot"}
              size={11}
              className={check.status === "PASSED" ? styles.statusOk : check.status === "FAILED" ? styles.statusError : styles.statusMuted}
            />
            <span className={styles.checkName}>{check.name}</span>
            <span className={styles.checkStatus}>{check.status.toLowerCase()}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (kind === "matches") {
    return (
      <ul className={styles.groupList}>
        {(details?.matches as Array<{ path?: string; file?: string; line?: number }>).slice(0, 20).map((match, index) => {
          const path = match.path || match.file;
          const label = `${path ?? "match"}${match.line ? `:${match.line}` : ""}`;
          return (
            <li key={`${label}-${index}`} className={styles.groupItem}>
              {path && onOpenFile ? (
                <button type="button" className={styles.groupItemLink} title={path} onClick={() => onOpenFile(path)}>
                  {label}
                </button>
              ) : (
                <span className={styles.groupItemText}>{label}</span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  const path = details?.path as string | undefined;
  if (path && onOpenFile) {
    return (
      <p className={styles.rowDetail}>
        <button type="button" className={styles.groupItemLink} title={path} onClick={() => onOpenFile(path)}>
          {path}
        </button>
      </p>
    );
  }
  return <p className={styles.rowDetail}>{entry.shortDescription}</p>;
}

/** The assistant's turn while it is still arriving. Appends without redrawing the list above. */
export function StreamingRow({ text }: { text: string }) {
  return (
    <div className={`${styles.row} ${styles.rowMessage}`} data-level="substance" data-status="active">
      <div className={styles.messageFull} aria-live="polite">
        {text}
        <span className={styles.caret} aria-hidden="true" />
      </div>
    </div>
  );
}
