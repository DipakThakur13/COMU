import type { Chunk, Source } from "./sourceFactory.ts";
import type { Logger } from "../util/logger.ts";

/**
 * Re-lists the inbox on an interval and yields anything it has not seen before.
 *
 * The seen set is in memory only, so a restart re-reads every file still in the inbox. The sink
 * is expected to swallow the repeats, which is why deduplication lives down there rather than up
 * here where the duplicate is actually created.
 */
export class PollingSource implements Source {
  readonly kind = "polling";
  private readonly seen = new Set<string>();
  private closed = false;

  constructor(
    private readonly inbox: string,
    private readonly intervalMs: number,
    private readonly listing: () => string[],
    private readonly readFile: (name: string) => string,
    private readonly logger: Logger,
    private readonly wait: (ms: number) => Promise<void> = ms =>
      new Promise(resolve => setTimeout(resolve, ms))
  ) {}

  async *chunks(): AsyncGenerator<Chunk> {
    while (!this.closed) {
      for (const name of this.listing().sort()) {
        if (this.seen.has(name)) continue;
        this.seen.add(name);
        this.logger.info("picked_up", { inbox: this.inbox, name });
        yield { name, bytes: this.readFile(name) };
      }
      await this.wait(this.intervalMs);
    }
  }

  close(): void {
    this.closed = true;
  }
}
