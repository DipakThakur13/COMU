/**
 * Counters only. There is no histogram and no exporter; /health reads the snapshot directly.
 */
export class Metrics {
  private readonly counters = new Map<string, number>();

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  get(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  reset(): void {
    this.counters.clear();
  }
}
