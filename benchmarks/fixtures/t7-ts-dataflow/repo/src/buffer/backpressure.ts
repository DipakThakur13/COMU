import type { RingBuffer } from "./ringBuffer.ts";

/** Above this fraction of capacity the buffer is considered under pressure. */
export const HIGH_WATER = 0.8;

/**
 * Answers whether the producer ought to slow down.
 *
 * It is advice, not a mechanism. There is no await, no semaphore and no queue depth limit behind
 * it; the only caller is the runner, which writes the answer to the log and keeps going. The
 * module exists because the design review asked for backpressure and this is as far as it got.
 */
export function shouldPause(buffer: RingBuffer): boolean {
  return buffer.size() >= Math.floor(buffer.capacity() * HIGH_WATER);
}

export function pressure(buffer: RingBuffer): number {
  return buffer.capacity() === 0 ? 0 : buffer.size() / buffer.capacity();
}
