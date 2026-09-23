import type { SessionState, UiState } from "@comu/ui-state";
import { Badge, ErrorBoundary, Icon, IconName } from "../primitives/index.js";
import { OverviewPanel } from "./OverviewPanel.js";
import { VerificationPanel } from "./VerificationPanel.js";
import { MemoryPanel } from "./MemoryPanel.js";
import { ContextPanel } from "./ContextPanel.js";
import { WorkersPanel } from "./WorkersPanel.js";
import styles from "./drawer.module.css";

export type DrawerSurface = NonNullable<UiState["drawer"]>;

export interface DrawerTab {
  id: DrawerSurface;
  label: string;
  icon: IconName;
  /** Shown as a badge when it is a count worth seeing at a glance. */
  count?: number;
}

/**
 * Which drawer surfaces have something to show.
 *
 * Exported because the visibility rule is the whole design: a surface that is always present but
 * usually empty is what produced the old seven-tab row, where most tabs led to "nothing here yet".
 * A tab appears when it has content and disappears when it does not.
 */
export function availableTabs(session: SessionState): DrawerTab[] {
  const tabs: DrawerTab[] = [];

  if (hasOverview(session)) {
    tabs.push({ id: "overview", label: "Overview", icon: "info" });
  }
  if (session.verification) {
    const failed = session.verification.checks.filter(c => c.status === "FAILED").length;
    tabs.push({ id: "verification", label: "Verification", icon: "verification", count: failed || undefined });
  }
  if (session.workers.length > 0) {
    tabs.push({ id: "workers", label: "Workers", icon: "worker", count: session.workers.length });
  }
  const context = session.workingSet.inspectedFiles.length + session.workingSet.modifiedFiles.length;
  if (context > 0) {
    tabs.push({ id: "context", label: "Context", icon: "file", count: context });
  }
  if (session.memory.length > 0) {
    tabs.push({ id: "memory", label: "Memory", icon: "memory", count: session.memory.length });
  }

  return tabs;
}

/**
 * Overview earns a tab once the task has produced something to summarise. A task that has only
 * just started has its status in the header already, so opening a drawer for it says nothing new.
 *
 * The final reply is deliberately not one of these: it lives in the stream, and a tab that only
 * ever repeated it was half of why the answer was printed twice.
 */
function hasOverview(session: SessionState): boolean {
  return Boolean(
    session.error ||
      session.diagnosis ||
      session.repairs.length > 0 ||
      session.approvals.length > 0 ||
      session.status === "cancelled"
  );
}

export interface DrawerProps {
  session: SessionState;
  open?: DrawerSurface;
  onSelect: (surface: DrawerSurface) => void;
  onOpenFile: (path: string) => void;
}

/**
 * Secondary surfaces, collapsed by default.
 *
 * Activity and Changes are the two destinations that earn permanent navigation. Everything else
 * lives here: present when it has something to say, one row of labelled tabs, closed until asked
 * for. The drawer opens over the stream rather than beside it, because the panel is often 300px
 * wide and there is no beside.
 */
export function Drawer({ session, open, onSelect, onOpenFile }: DrawerProps) {
  const tabs = availableTabs(session);
  if (tabs.length === 0) return null;

  // A surface can lose its content while it is open; fall back to the strip rather than an
  // empty body claiming a tab that is no longer there.
  const active = tabs.some(t => t.id === open) ? open : undefined;

  return (
    <section className={styles.drawer} aria-label="Task detail">
      {active ? (
        <div className={styles.body} role="region" aria-label={tabs.find(t => t.id === active)!.label}>
          <ErrorBoundary region={`${active} panel`}>
            {active === "overview" ? <OverviewPanel session={session} /> : null}
            {active === "verification" ? <VerificationPanel result={session.verification!} /> : null}
            {active === "workers" ? <WorkersPanel workers={session.workers} /> : null}
            {active === "memory" ? <MemoryPanel entries={session.memory} /> : null}
            {active === "context" ? <ContextPanel workingSet={session.workingSet} onOpenFile={onOpenFile} /> : null}
          </ErrorBoundary>
        </div>
      ) : null}

      <div className={styles.strip} role="tablist" aria-label="Task detail surfaces">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-expanded={active === tab.id}
            className={`${styles.tab} ${active === tab.id ? styles.active : ""}`}
            onClick={() => onSelect(tab.id)}
          >
            <Icon name={tab.icon} size={12} />
            <span>{tab.label}</span>
            {tab.count ? <Badge title={`${tab.count}`}>{tab.count}</Badge> : null}
            <Icon name={active === tab.id ? "chevronDown" : "chevronRight"} size={11} className={styles.chevron} />
          </button>
        ))}
      </div>
    </section>
  );
}
