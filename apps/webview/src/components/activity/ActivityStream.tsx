import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ActivityEntry, LiveStatus } from "@comu/ui-state";
import { Button, EmptyState, Icon } from "../primitives/index.js";
import { ActivityRow, StreamingRow } from "./ActivityItemView.js";
import { LiveStatusLine } from "./LiveStatusLine.js";
import styles from "./activity.module.css";

export interface ActivityStreamProps {
  entries: ActivityEntry[];
  elidedCount: number;
  streamingText?: string;
  /** What is happening now. Pinned below the stream, never appended to it. */
  live?: LiveStatus;
  expandedIds: string[];
  onToggle: (id: string) => void;
  status: string;
  emptyHint?: string;
  /** Rendered instead of the default empty state, for the first-run surface. */
  emptyContent?: ReactNode;
  onSaveCode?: (content: string, suggestedPath: string) => void;
  onOpenFile?: (path: string) => void;
  onRequestDiff?: (path: string) => void;
}

/**
 * The primary surface.
 *
 * Virtualised: a long task emits thousands of events and rendering them all is what made the old
 * interface stall. Rows are measured dynamically because an expanded group is much taller than a
 * collapsed one.
 *
 * Follows the tail while the user is at the bottom, and stops following the moment they scroll up,
 * so reading history is never yanked away mid-sentence.
 */
export function ActivityStream({
  entries,
  elidedCount,
  streamingText,
  live,
  expandedIds,
  onToggle,
  status,
  emptyHint,
  emptyContent,
  onSaveCode,
  onOpenFile,
  onRequestDiff
}: ActivityStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 12,
    // First-paint estimate so the initial render is a sensible window rather than nothing; the
    // real viewport replaces it as soon as the scroller is measured.
    initialRect: { width: 320, height: 600 },
    getItemKey: index => entries[index]?.id ?? index
  });

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setFollowing(atBottom);
  }, []);

  // Stay pinned to the newest activity only while the user has not scrolled away.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !following) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length, streamingText, following]);

  useEffect(() => {
    if (entries.length > 0 && expandedIds.length >= 0) virtualizer.measure();
  }, [expandedIds, entries.length, virtualizer]);

  if (entries.length === 0 && !streamingText && !live) {
    return (
      <div className={styles.stream}>
        {emptyContent ?? (
          <EmptyState icon="agent" title="Nothing running">
            {emptyHint ?? "Describe a change and COMU will plan it, make it and verify it."}
          </EmptyState>
        )}
      </div>
    );
  }

  const items = virtualizer.getVirtualItems();

  return (
    <div className={styles.stream}>
      {elidedCount > 0 ? (
        <div className={styles.elided}>
          <Icon name="history" size={12} />
          <span>
            {elidedCount.toLocaleString()} earlier {elidedCount === 1 ? "activity" : "activities"} elided
          </span>
        </div>
      ) : null}

      <div ref={scrollRef} className={styles.scroller} onScroll={onScroll} role="log" aria-label="Activity" aria-busy={status === "running"}>
        <div className={styles.virtualCanvas} style={{ height: virtualizer.getTotalSize() }}>
          <div
            className={styles.virtualWindow}
            style={{ transform: `translateY(${items[0]?.start ?? 0}px)` }}
          >
            {items.map(item => {
              const entry = entries[item.index];
              if (!entry) return null;
              return (
                <div key={item.key} data-index={item.index} ref={virtualizer.measureElement}>
                  <ActivityRow
                    entry={entry}
                    expanded={expandedIds.includes(entry.id)}
                    onToggle={onToggle}
                    onSaveCode={onSaveCode}
                    onOpenFile={onOpenFile}
                    onRequestDiff={onRequestDiff}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {streamingText ? <StreamingRow text={streamingText} /> : null}
      </div>

      {live ? <LiveStatusLine live={live} /> : null}

      {!following ? (
        <div className={`${styles.followAffordance} ${live ? styles.followAboveLive : ""}`}>
          <Button
            variant="secondary"
            small
            icon="chevronDown"
            onClick={() => {
              setFollowing(true);
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
          >
            Jump to latest
          </Button>
        </div>
      ) : null}
    </div>
  );
}
