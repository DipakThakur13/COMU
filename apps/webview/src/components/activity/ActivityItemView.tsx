import { memo } from "react";
import type { ActivityEntry, ActivityItem, ActivityStatus, ToolCategory } from "@comu/ui-state";
import { isActivityGroup } from "@comu/ui-state";
import { Badge, Icon, IconName } from "../primitives/index.js";
import { MessageText } from "./MessageText.js";
import styles from "./activity.module.css";

const TOOL_ICON: Record<ToolCategory, IconName> = {
  Read: "file",
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

function iconFor(entry: ActivityEntry): IconName {
  if (entry.category === "APPROVAL") return "approval";
  if (entry.category === "AGENT_MESSAGE") return "agent";
  if (entry.category === "VALIDATION") return "verification";
  if (entry.category === "DIAGNOSIS") return "diagnosis";
  if (entry.category === "REPAIR") return "repair";
  if (entry.category === "COMMAND_OUTPUT") return "terminal";
  if (entry.toolCategory) return TOOL_ICON[entry.toolCategory];
  return "dot";
}

export interface ActivityRowProps {
  entry: ActivityEntry;
  expanded: boolean;
  onToggle: (id: string) => void;
  onSaveCode?: (content: string, suggestedPath: string) => void;
}

/**
 * One row in the stream. Memoised on identity: the reducer returns new objects only for entries
 * that actually changed, so appending an event does not re-render the history above it.
 */
export const ActivityRow = memo(function ActivityRow({ entry, expanded, onToggle, onSaveCode }: ActivityRowProps) {
  const group = isActivityGroup(entry);
  const message = entry.category === "AGENT_MESSAGE";
  const expandable = group || message || !!entry.shortDescription;

  return (
    <div className={`${styles.row} ${message ? styles.rowMessage : ""}`} data-status={entry.status}>
      <button
        type="button"
        className={styles.rowHeader}
        onClick={expandable ? () => onToggle(entry.id) : undefined}
        aria-expanded={expandable ? expanded : undefined}
        disabled={!expandable}
      >
        <span className={`${styles.rowIcon} ${STATUS_CLASS[entry.status]}`}>
          <Icon name={iconFor(entry)} spin={entry.status === "active" && entry.category !== "AGENT_MESSAGE"} />
        </span>
        <span className={styles.rowBody}>
          <span className={styles.rowTitle}>{entry.title}</span>
          {!expanded && entry.shortDescription && !message ? (
            <span className={styles.rowSubtitle}>{entry.shortDescription}</span>
          ) : null}
          {message && !expanded ? (
            <span className={styles.messageClamped}>{entry.shortDescription}</span>
          ) : null}
        </span>
        {group ? <Badge title={`${entry.items.length} items`}>{entry.items.length}</Badge> : null}
        {expandable ? <Icon name={expanded ? "chevronDown" : "chevronRight"} className={styles.rowChevron} /> : null}
      </button>

      {expanded && group ? (
        <ul className={styles.groupList}>
          {entry.items.map(item => (
            <li key={item.id} className={styles.groupItem}>
              <Icon name={iconFor(item)} size={12} className={STATUS_CLASS[item.status]} />
              <span className={styles.groupItemText}>{item.shortDescription || item.title}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        The expanded message sits outside the header button. Its code blocks carry Copy and Save
        controls, and a button inside a button is neither valid nor reachable by keyboard.
      */}
      {expanded && message ? (
        <div className={styles.messageFull}>
          <MessageText text={entry.shortDescription ?? ""} onSaveCode={onSaveCode} />
        </div>
      ) : null}

      {expanded && !group && entry.shortDescription && !message ? (
        <p className={styles.rowDetail}>{entry.shortDescription}</p>
      ) : null}

      {expanded && message && (entry as ActivityItem).details?.reasoning ? (
        <details className={styles.reasoning}>
          <summary>Reasoning</summary>
          <p>{String((entry as ActivityItem).details?.reasoning)}</p>
        </details>
      ) : null}
    </div>
  );
});

/** The assistant's turn while it is still arriving. Appends without redrawing the list above. */
export function StreamingRow({ text }: { text: string }) {
  return (
    <div className={`${styles.row} ${styles.rowMessage}`} data-status="active">
      <div className={styles.rowHeader}>
        <span className={`${styles.rowIcon} ${styles.statusRunning}`}>
          <Icon name="agent" />
        </span>
        <span className={styles.rowBody}>
          <span className={styles.rowTitle}>Assistant</span>
          <span className={styles.messageFull} aria-live="polite">
            {text}
            <span className={styles.caret} aria-hidden="true" />
          </span>
        </span>
      </div>
    </div>
  );
}
