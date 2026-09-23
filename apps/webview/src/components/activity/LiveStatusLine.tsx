import { useEffect, useState } from "react";
import type { LiveStatus } from "@comu/ui-state";
import { Icon } from "../primitives/index.js";
import styles from "./activity.module.css";

/**
 * What is happening now, on one line, replaced in place.
 *
 * This is where "Thinking", "Running tools" and "Reading src/pagination.ts" live. They are not
 * events — they are the absence of one — so they never enter the history: the line updates as the
 * task moves and disappears the moment it ends, leaving a stream that contains only things that
 * happened.
 */
export function LiveStatusLine({ live }: { live: LiveStatus }) {
  const started = Date.parse(live.startedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live.startedAt]);

  const seconds = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;

  return (
    <div className={styles.live} role="status" aria-live="polite">
      <Icon name="sync" size={12} spin className={styles.statusRunning} />
      <span className={styles.liveLabel}>{live.label}</span>
      {seconds > 0 ? <span className={styles.liveElapsed}>{formatSeconds(seconds)}</span> : null}
    </div>
  );
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}
