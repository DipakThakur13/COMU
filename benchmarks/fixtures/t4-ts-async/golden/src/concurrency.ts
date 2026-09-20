/** A worker pool with a fixed width. */

/**
 * Runs `worker` over every item, at most `limit` at a time, and returns one result per item in the
 * order the items were given.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  const lanes = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  async function runLane(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const value = await worker(items[index] as T, index);
      results[index] = value;
    }
  }

  await Promise.all(Array.from({ length: lanes }, () => runLane()));
  return results;
}
