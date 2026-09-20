import type { StoredConsignment } from "../domain/consignment.ts";
import type { Clock } from "../ports/clock.ts";
import type { Ledger } from "../ports/ledger.ts";
import type { Metrics } from "../telemetry/metrics.ts";

interface Entry {
  value: StoredConsignment | undefined;
  expiresAt: number;
}

/**
 * Sits between the read side and the ledger.
 *
 * It caches misses as well as hits, which is what makes it useful in front of a database that
 * is asked for ids that do not exist yet. It also has an `invalidate` method that nothing in
 * this repository calls: the write path runs through the outbox and the drain, neither of which
 * holds a reference to this object, so an entry only ever leaves by expiring.
 */
export class ReadThroughCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ledger: Ledger,
    private readonly clock: Clock,
    private readonly ttlMs: number,
    private readonly metrics: Metrics
  ) {}

  async byId(id: string): Promise<StoredConsignment | undefined> {
    const now = this.clock.ticks();
    const cached = this.entries.get(id);
    if (cached && cached.expiresAt > now) {
      this.metrics.increment("cache.hit");
      return cached.value;
    }

    this.metrics.increment("cache.miss");
    const value = await this.ledger.byId(id);
    this.entries.set(id, { value, expiresAt: now + this.ttlMs });
    return value;
  }

  /** Account listings are not cached; they are too easy to get wrong. */
  byAccount(account: string): Promise<StoredConsignment[]> {
    return this.ledger.byAccount(account);
  }

  invalidate(id: string): void {
    this.entries.delete(id);
  }

  size(): number {
    return this.entries.size;
  }
}
