import type { RawRecord } from "../decode/decoderRegistry.ts";

/**
 * A fixed ring between decoding and the stages.
 *
 * When it is full it overwrites the oldest entry rather than blocking or throwing. The only trace
 * of a lost record is the dropped counter, which the runner copies into the final summary and
 * nothing alerts on. This is the single place in the repository where data can disappear without
 * an error.
 */
export class RingBuffer {
  private readonly slots: Array<RawRecord | undefined>;
  private head = 0;
  private tail = 0;
  private filled = 0;
  private dropped = 0;

  constructor(private readonly slotCount: number) {
    this.slots = new Array<RawRecord | undefined>(slotCount);
  }

  push(record: RawRecord): void {
    if (this.filled === this.slotCount) {
      this.tail = (this.tail + 1) % this.slotCount;
      this.filled -= 1;
      this.dropped += 1;
    }
    this.slots[this.head] = record;
    this.head = (this.head + 1) % this.slotCount;
    this.filled += 1;
  }

  *drain(): Generator<RawRecord> {
    while (this.filled > 0) {
      const record = this.slots[this.tail];
      this.slots[this.tail] = undefined;
      this.tail = (this.tail + 1) % this.slotCount;
      this.filled -= 1;
      if (record) yield record;
    }
  }

  size(): number {
    return this.filled;
  }

  capacity(): number {
    return this.slotCount;
  }

  droppedCount(): number {
    return this.dropped;
  }
}
