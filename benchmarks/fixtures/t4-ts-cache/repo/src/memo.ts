/** A tiny memo helper for pure lookups. */

/** Wraps `fn` so that repeated calls with the same arguments reuse the first result. */
export function memoize<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const cache = new Map<string, R>();
  return (...args: A): R => {
    const key = cacheKey(args);
    if (!cache.has(key)) {
      cache.set(key, fn(...args));
    }
    return cache.get(key) as R;
  };
}

/** Builds the cache key for one call. */
function cacheKey(args: unknown[]): string {
  return String(args[0]);
}
