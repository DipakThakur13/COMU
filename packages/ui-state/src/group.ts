import { ActivityEntry, ActivityGroup, ActivityItem, ToolCategory, isActivityGroup } from "./types.js";
import { basename } from "./normalize.js";

/**
 * Looking around is one row, however many times the agent did it.
 *
 * Only routine work folds: a run of reads, of directory listings or of searches becomes one row
 * carrying the count and the first name, expandable into the list. Substance never folds, because
 * two edits are two changes to review, and an outcome never folds because there is only ever one.
 */
const GROUPABLE: ToolCategory[] = ["Read", "Explore", "Search"];

/**
 * Appends one row, folding it into the previous row when the two are the same kind of routine.
 *
 * Incremental by design: the caller passes the existing entries and the single new row, so a long
 * task never re-folds its whole history on every event.
 */
export function appendActivity(entries: ActivityEntry[], item: ActivityItem): ActivityEntry[] {
  const last = entries[entries.length - 1];

  // A row can replace an earlier one it owns: a worker's completion updates the row its start
  // created rather than adding a second one. Only ids that are deliberately stable are looked up,
  // and from the end, so the common case of appending never scans the history.
  if (isOwnedRowId(item.id)) {
    for (let index = entries.length - 1; index >= 0; index--) {
      if (entries[index].id === item.id) {
        return entries.map((entry, i) => (i === index ? item : entry));
      }
    }
  }

  const groupable = item.level === "routine" && !!item.toolCategory && GROUPABLE.includes(item.toolCategory);
  if (!groupable || !last) {
    return [...entries, item];
  }

  // Extend an existing group of the same kind.
  if (isActivityGroup(last) && last.toolCategory === item.toolCategory) {
    return [...entries.slice(0, -1), buildGroup([...last.items, item])];
  }

  // Two singles of the same kind become a group.
  if (!isActivityGroup(last) && last.level === "routine" && last.toolCategory === item.toolCategory) {
    return [...entries.slice(0, -1), buildGroup([last, item])];
  }

  return [...entries, item];
}

/**
 * Whether a row id names a row that outlives the event that created it.
 *
 * Event-derived ids are unique per event and can never collide; these two are the exception, and
 * are the reason a worker does not appear twice and a reply is not printed twice.
 */
function isOwnedRowId(id: string): boolean {
  return id.startsWith("worker-") || id.startsWith("msg-");
}

export function buildGroup(items: ActivityItem[]): ActivityGroup {
  const first = items[0];
  const category = (first.toolCategory || "Generic") as ToolCategory;
  const count = items.length;

  return {
    // Keyed on the first row, not on the size: a group that grows keeps its identity, so expanding
    // it does not collapse again the moment the next read arrives.
    id: `group-${first.id}`,
    isGroup: true,
    category: first.category,
    toolCategory: category,
    level: "routine",
    status: items.some(i => i.status === "failed")
      ? "failed"
      : items.some(i => i.status === "active")
        ? "active"
        : "completed",
    title: groupTitle(category, count),
    shortDescription: groupSubjects(category, items),
    items,
    timestamp: items[items.length - 1].timestamp
  };
}

function groupTitle(category: ToolCategory, count: number): string {
  switch (category) {
    case "Read":
      return `Read ${count} files`;
    case "Explore":
      return `Explored ${count} ${count === 1 ? "directory" : "directories"}`;
    case "Search":
      return `Searched ${count} times`;
    default:
      return `${count} ${category.toLowerCase()} actions`;
  }
}

/** "pagination.ts +2 more": the first subject by name, and how many others there were. */
function groupSubjects(category: ToolCategory, items: ActivityItem[]): string | undefined {
  const subjects = items
    .map(item => subjectOf(category, item))
    .filter((value): value is string => !!value);
  if (subjects.length === 0) return undefined;

  const unique = [...new Set(subjects)];
  const rest = unique.length - 1;
  return rest > 0 ? `${unique[0]} +${rest} more` : unique[0];
}

function subjectOf(category: ToolCategory, item: ActivityItem): string | undefined {
  const details = item.details as { path?: string; query?: string } | undefined;
  if (category === "Search") {
    return details?.query ? `"${details.query}"` : undefined;
  }
  return details?.path ? basename(details.path) : undefined;
}

/** Folds a whole list at once. Used when rebuilding from a snapshot. */
export function groupActivity(items: ActivityItem[]): ActivityEntry[] {
  let entries: ActivityEntry[] = [];
  for (const item of items) entries = appendActivity(entries, item);
  return entries;
}
