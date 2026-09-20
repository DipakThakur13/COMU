import { useEffect } from "react";
import { useStore } from "./store/store.js";
import { Header } from "./components/Header.js";
import { Composer } from "./components/Composer.js";
import { SurfaceTabs } from "./components/SurfaceTabs.js";
import { ActivityStream } from "./components/activity/ActivityStream.js";
import { ApprovalCard } from "./components/approval/ApprovalCard.js";
import { PlanRibbon } from "./components/plan/PlanRibbon.js";
import { ChangesPanel } from "./components/changes/ChangesPanel.js";
import { Drawer } from "./components/drawer/Drawer.js";
import { SettingsView } from "./components/settings/SettingsView.js";
import { Button, ErrorBoundary } from "./components/primitives/index.js";
import styles from "./app.module.css";

export function App() {
  const session = useStore(s => s.session);
  const ui = useStore(s => s.ui);
  const providers = useStore(s => s.providers);
  const banner = useStore(s => s.banner);
  const store = useStore();

  const providerTests = useStore(s => s.providerTests);
  const testingProvider = useStore(s => s.testingProvider);

  const busy = session.status === "running" || session.status === "cancelling";

  // Esc stops a running task from anywhere in the panel. Nothing here approves anything.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busy) {
        event.preventDefault();
        store.cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, store]);

  if (ui.settingsOpen) {
    return (
      <div className={styles.shell}>
        <ErrorBoundary region="settings">
          <SettingsView
            providers={providers}
            testResults={providerTests}
            testing={testingProvider}
            onClose={() => store.setSettingsOpen(false)}
            onSave={store.saveProviderKey}
            onRemove={store.removeProviderKey}
            onTest={store.testProvider}
          />
        </ErrorBoundary>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <ErrorBoundary region="header">
        <Header session={session} onCancel={store.cancel} onOpenSettings={() => store.setSettingsOpen(true)} />
      </ErrorBoundary>

      {banner ? (
        <div className={styles.banner} role="alert">
          <div>
            <p className={styles.bannerMessage}>{banner.message}</p>
            {banner.hint ? <p className={styles.bannerHint}>{banner.hint}</p> : null}
          </div>
          <Button variant="ghost" small icon="close" label="Dismiss" onClick={store.dismissBanner} />
        </div>
      ) : null}

      {session.replication.needsResync ? (
        <div className={styles.banner} role="status">
          <p className={styles.bannerMessage}>Reconnecting to the task…</p>
        </div>
      ) : null}

      <SurfaceTabs active={ui.surface} changeCount={session.changes.length} onSelect={store.setSurface} />

      {session.plan && ui.surface === "activity" ? (
        <ErrorBoundary region="plan">
          <PlanRibbon plan={session.plan} />
        </ErrorBoundary>
      ) : null}

      {ui.surface === "activity" ? (
        <>
          {session.pendingApproval ? (
            <ErrorBoundary region="approval card">
              <ApprovalCard approval={session.pendingApproval} onRespond={store.respondInteraction} />
            </ErrorBoundary>
          ) : null}

          <ErrorBoundary region="activity stream">
            <ActivityStream
              entries={session.activity}
              elidedCount={session.elidedCount}
              streamingText={session.streaming?.text}
              expandedIds={ui.expandedActivityIds}
              onToggle={store.toggleExpanded}
              status={session.status}
            />
          </ErrorBoundary>
        </>
      ) : (
        <ErrorBoundary region="changes">
          <ChangesPanel changes={session.changes} onOpenFile={store.openFile} onRequestDiff={store.requestDiff} />
        </ErrorBoundary>
      )}

      <ErrorBoundary region="task detail drawer">
        <Drawer session={session} open={ui.drawer} onSelect={store.setDrawer} />
      </ErrorBoundary>

      <ErrorBoundary region="composer">
        <Composer
          text={ui.composer.text}
          mode={ui.composer.mode}
          autonomy={ui.composer.autonomy}
          modelId={ui.composer.modelId}
          providers={providers}
          busy={busy}
          onText={store.setComposerText}
          onMode={store.setMode}
          onAutonomy={store.setAutonomy}
          onModel={store.setModel}
          onSubmit={store.submit}
        />
      </ErrorBoundary>
    </div>
  );
}
