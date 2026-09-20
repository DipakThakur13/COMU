import { ActivityEntry, ActivityGroup, ActivityItem, ToolCategory, isActivityGroup } from "./types.js";

const GROUPABLE: ToolCategory[] = ["Read", "Search"];

/**
 * Collapses a run of consecutive same-kind read or search items into one group.
 *
 * Appending is incremental: the caller passes the existing entries and the single new item, so a
 * long task never re-groups its whole history on every event.
 */
export function appendActivity(entries: ActivityEntry[], item: ActivityItem): ActivityEntry[] {
  const last = entries[entries.length - 1];
  const groupable = item.category === "TOOL_ACTIVITY" && !!item.toolCategory && GROUPABLE.includes(item.toolCategory);

  if (!groupable || !last) {
    return [...entries, item];
  }

  // Extend an existing group of the same kind.
  if (isActivityGroup(last) && last.toolCategory === item.toolCategory) {
    const items = [...last.items, item];
    return [...entries.slice(0, -1), buildGroup(items)];
  }

  // Two singles of the same kind become a group.
  if (!isActivityGroup(last) && last.category === "TOOL_ACTIVITY" && last.toolCategory === item.toolCategory) {
    return [...entries.slice(0, -1), buildGroup([last, item])];
  }

  return [...entries, item];
}

export function buildGroup(items: ActivityItem[]): ActivityGroup {
  const first = items[0];
  const category = (first.toolCategory || "Generic") as ToolCategory;
  const title =
    category === "Read"
      ? `Read ${items.length} files`
      : category === "Search"
        ? `Searched the repository (${items.length} queries)`
        : `${category} operations (${items.length})`;

  return {
    id: `group-${first.id}-${items.length}`,
    isGroup: true,
    category: first.category,
    toolCategory: category,
    status: items.some(i => i.status === "failed")
      ? "failed"
      : items.some(i => i.status === "active")
        ? "active"
        : "completed",
    title,
    shortDescription: `${items.length} ${category.toLowerCase()} activities`,
    items,
    timestamp: items[items.length - 1].timestamp
  };
}

/** Groups a whole list at once. Used when rebuilding from a snapshot. */
export function groupActivity(items: ActivityItem[]): ActivityEntry[] {
  let entries: ActivityEntry[] = [];
  for (const item of items) entries = appendActivity(entries, item);
  return entries;
}
