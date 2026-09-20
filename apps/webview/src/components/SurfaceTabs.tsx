import type { UiState } from "@comu/ui-state";
import { Badge, Icon } from "./primitives/index.js";
import styles from "./surfaceTabs.module.css";

export interface SurfaceTabsProps {
  active: UiState["surface"];
  changeCount: number;
  onSelect: (surface: UiState["surface"]) => void;
}

/**
 * Two tabs, not seven.
 *
 * Activity is the signature surface and Changes is where review happens, so those are the only
 * destinations that earn permanent navigation. Everything else moves into the drawer and appears
 * only when it has content. Labels always render: an unlabelled icon row is what the old
 * navigation degenerated into at real sidebar width.
 */
export function SurfaceTabs({ active, changeCount, onSelect }: SurfaceTabsProps) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Panel surface">
      <button
        type="button"
        role="tab"
        aria-selected={active === "activity"}
        className={`${styles.tab} ${active === "activity" ? styles.active : ""}`}
        onClick={() => onSelect("activity")}
      >
        <Icon name="agent" size={13} />
        <span>Activity</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === "changes"}
        className={`${styles.tab} ${active === "changes" ? styles.active : ""}`}
        onClick={() => onSelect("changes")}
      >
        <Icon name="diff" size={13} />
        <span>Changes</span>
        {changeCount > 0 ? <Badge title={`${changeCount} changed files`}>{changeCount}</Badge> : null}
      </button>
    </div>
  );
}
