import type { Quote } from "../schema/quote.ts";
import { quoteKey } from "../util/ids.ts";

export interface Segment {
  id: number;
  sealedAt: string;
  rows: Quote[];
}

/**
 * Segment-oriented storage.
 *
 * Appends land in an open staging segment held in memory. Only sealed segments are visible to
 * readers, which is the reason a freshly ingested row cannot be queried until the indexer seals.
 *
 * Deduplication also happens here rather than at the source, keyed by quoteKey from
 * src/util/ids.ts. The catch is that the key set is per staging segment and is thrown away on
 * seal, so a duplicate that straddles a seal boundary is stored twice.
 */
export class ColumnStore {
  private readonly sealed: Segment[] = [];
  private staging: Quote[] = [];
  private keys = new Set<string>();
  private nextId = 1;

  constructor(private readonly dir: string) {}

  append(quote: Quote): boolean {
    const key = quoteKey(quote);
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.staging.push(quote);
    return true;
  }

  stagingDepth(): number {
    return this.staging.length;
  }

  seal(sealedAt: string): Segment | undefined {
    if (this.staging.length === 0) return undefined;
    const segment: Segment = { id: this.nextId, sealedAt, rows: this.staging };
    this.nextId += 1;
    this.sealed.push(segment);
    this.staging = [];
    this.keys = new Set<string>();
    return segment;
  }

  /** Readers see this and nothing else. */
  sealedSegments(): readonly Segment[] {
    return this.sealed;
  }

  location(): string {
    return this.dir;
  }
}
