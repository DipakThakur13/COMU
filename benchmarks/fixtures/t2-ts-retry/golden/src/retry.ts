/** Repeating a call that failed for a reason worth repeating. */

export interface RetryOptions {
  /** Total attempts, the first one included. One means no repeating at all. */
  attempts: number;
  /**
   * Decides whether a failed attempt is worth repeating. Called with the error and the 1-based
   * number of the attempt that produced it. Defaults to repeating every failure.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/**
 * Calls `fn` until it succeeds, the attempts run out, or `shouldRetry` says to stop.
 *
 * No backoff: the caller that wants one can wait inside `fn`, and a benchmark that sleeps is a
 * benchmark nobody runs.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const { attempts, shouldRetry } = options;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(`attempts must be an integer of at least one: ${attempts}`);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      // The last attempt has nothing left to decide, so the predicate is not asked.
      if (attempt === attempts) break;
      if (shouldRetry !== undefined && !shouldRetry(error, attempt)) break;
    }
  }
  throw lastError;
}
