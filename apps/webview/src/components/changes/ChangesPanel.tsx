import { useState } from "react";
import type { ChangeView } from "@comu/ui-state";
import { Button, EmptyState, Icon } from "../primitives/index.js";
import styles from "./changes.module.css";

function splitPath(path: string): { dir: string; file: string } {
  const unified = String(path).replace(/\\/g, "/");
  const index = unified.lastIndexOf("/");
  return index === -1 ? { dir: "", file: unified } : { dir: unified.slice(0, index), file: unified.slice(index + 1) };
}

export interface ChangesPanelProps {
  changes: ChangeView[];
  onOpenFile: (path: string) => void;
  onRequestDiff: (path: string) => void;
}

/**
 * Every file the task has written.
 *
 * Read only, deliberately. Approval happens before the write, so by the time a change appears here
 * it is already on disk, and COMU has no revert: there is nothing in the engine that would restore
 * a file from the change set's original content. Offering checkboxes or an "accept" control would
 * imply an undo that does not exist, so this view reviews and opens, and says so.
 */
export function ChangesPanel({ changes, onOpenFile, onRequestDiff }: ChangesPanelProps) {
  const [expanded, setExpanded] = useState<string>();

  if (changes.length === 0) {
    return (
      <div className={styles.panel}>
        <EmptyState icon="diff" title="No changes yet">
          Files the task writes appear here, with a diff against what was there before.
        </EmptyState>
      </div>
    );
  }

  const creates = changes.filter(c => c.operation === "CREATE").length;
  const modifies = changes.length - creates;

  return (
    <div className={styles.panel}>
      <div className={styles.summary}>
        <span>
          {changes.length} {changes.length === 1 ? "file" : "files"}
        </span>
        {creates > 0 ? <span>{creates} created</span> : null}
        {modifies > 0 ? <span>{modifies} modified</span> : null}
        <p className={styles.readOnlyNote}>
          Already written to disk. Open a file to inspect or undo it with your editor's own history.
        </p>
      </div>

      <ul className={styles.list} aria-label="Changed files">
        {changes.map(change => {
          const { dir, file } = splitPath(change.path);
          const isOpen = expanded === change.path;
          return (
            <li key={change.path} className={styles.item}>
              <button
                type="button"
                className={styles.itemHeader}
                onClick={() => setExpanded(isOpen ? undefined : change.path)}
                aria-expanded={isOpen}
              >
                <Icon
                  name={change.operation === "CREATE" ? "create" : "edit"}
                  size={13}
                  className={change.operation === "CREATE" ? styles.opCreate : styles.opModify}
                />
                <span className={styles.pathCell}>
                  <span className={styles.fileName}>{file}</span>
                  {dir ? <span className={styles.dirName}>{dir}</span> : null}
                </span>
                <span className={styles.opLabel}>{change.operation === "CREATE" ? "new" : "changed"}</span>
                <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={12} className={styles.opIcon} />
              </button>

              {isOpen ? (
                <div className={styles.openButton}>
                  <Button variant="secondary" small icon="file" onClick={() => onOpenFile(change.path)}>
                    Open file
                  </Button>{" "}
                  <Button variant="secondary" small icon="diff" onClick={() => onRequestDiff(change.path)}>
                    Open diff
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
