import { TaskCancelledError } from "@comu/shared";

/**
 * Cancellation helpers.
 *
 * `ToolContext.abortSignal` is required and is the only cancellation mechanism. There used to be a
 * second, optional one (`CancellationSignal`), and having two optional ways to express the same
 * thing is exactly why six tool packages drifted: each author picked one, or neither, and nothing
 * caught it. See docs/CANCELLATION_AUDIT.md.
 *
 * Every tool calls `throwIfAborted` before doing work, and threads the signal into anything that
 * can block. The conformance suite in apps/agent-runtime/tests/tool_conformance.test.ts asserts it
 * over the whole registry, so a new tool is covered without anyone remembering to add it.
 */

/** Refuses immediately when the task has already been cancelled. */
export function throwIfAborted(signal: AbortSignal | undefined, toolName: string): void {
  if (signal?.aborted) {
    throw new TaskCancelledError(`${toolName} was cancelled before it started`);
  }
}

/** Rejects as soon as the signal aborts. Never resolves; race it against real work. */
export function abortPromise(signal: AbortSignal, toolName: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(new TaskCancelledError(`${toolName} was cancelled`));
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(new TaskCancelledError(`${toolName} was cancelled`)),
      { once: true }
    );
  });
}

/**
 * Runs work that cannot itself observe a signal (a filesystem call, say) and rejects promptly on
 * cancellation. The underlying operation still completes; what this guarantees is that the caller
 * stops waiting and that no result is acted on after cancellation.
 */
export async function raceAbort<T>(signal: AbortSignal, toolName: string, work: Promise<T>): Promise<T> {
  throwIfAborted(signal, toolName);
  // Observed so an abandoned operation can never surface as an unhandled rejection.
  work.catch(() => undefined);
  return Promise.race([work, abortPromise(signal, toolName)]);
}

/** A signal that never aborts, for callers with nothing to cancel (tests, one-shot scripts). */
export function neverAborted(): AbortSignal {
  return new AbortController().signal;
}
