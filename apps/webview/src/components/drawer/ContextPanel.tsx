import type { WorkingSetView } from "@comu/ui-state";
import { Badge, EmptyState, Icon } from "../primitives/index.js";
import styles from "./drawer.module.css";

/** Keeps the tail of a long path, which is the part that identifies the file. */
function shorten(path: string): string {
  const parts = String(path).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : parts.join("/");
}

export interface ContextPanelProps {
  workingSet: WorkingSetView;
  onOpenFile: (path: string) => void;
}

/**
 * What COMU is working on: the files it has read and the files it has written.
 *
 * Answers "does it understand the right part of the codebase" while a task is still running,
 * which is the moment when the answer is worth something. Every entry opens the real file in the
 * editor, so this is a way into the code rather than a list to read.
 */
export function ContextPanel({ workingSet, onOpenFile }: ContextPanelProps) {
  const { inspectedFiles, modifiedFiles } = workingSet;

  if (inspectedFiles.length === 0 && modifiedFiles.length === 0) {
    return (
      <div className={styles.panelBody}>
        <EmptyState icon="file" title="No files in play yet">
          Files COMU reads and files it writes appear here as the task runs.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className={styles.panelBody}>
      {modifiedFiles.length > 0 ? (
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>
            <Icon name="edit" size={12} />
            Written <Badge>{modifiedFiles.length}</Badge>
          </h3>
          <FileList paths={modifiedFiles} onOpenFile={onOpenFile} />
        </section>
      ) : null}

      {inspectedFiles.length > 0 ? (
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>
            <Icon name="file" size={12} />
            Read <Badge>{inspectedFiles.length}</Badge>
          </h3>
          <FileList paths={inspectedFiles} onOpenFile={onOpenFile} />
        </section>
      ) : null}
    </div>
  );
}

function FileList({ paths, onOpenFile }: { paths: string[]; onOpenFile: (path: string) => void }) {
  return (
    <ul className={styles.chips}>
      {paths.map(path => (
        <li key={path}>
          <button type="button" className={styles.chip} title={path} onClick={() => onOpenFile(path)}>
            {shorten(path)}
          </button>
        </li>
      ))}
    </ul>
  );
}
