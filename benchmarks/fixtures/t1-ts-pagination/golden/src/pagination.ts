export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  totalPages: number;
}

/** Returns the slice of `items` belonging to a zero-based page. */
export function pageSlice<T>(items: T[], page: number, size: number): T[] {
  const start = page * size;
  const end = start + size;
  return items.slice(start, end);
}

export function paginate<T>(items: T[], page: number, size: number): Page<T> {
  return {
    items: pageSlice(items, page, size),
    page,
    size,
    totalPages: Math.ceil(items.length / size)
  };
}
