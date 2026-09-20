import type { Quote } from "../schema/quote.ts";
import type { Clock } from "../util/clock.ts";

/**
 * Append-only journal, written before anything reaches a segment.
 *
 * It exists so a crash between an append and a seal loses nothing. It is not readable by the
 * query layer: src/query/reader.ts never opens it. Recovery replays it into the column store on
 * the next start, which is why a crash makes rows appear late rather than never.
 */
export class WriteAheadLog {
  private readonly lines: string[] = [];

  constructor(
    private readonly path: string,
    private readonly clock: Clock,
    private readonly sync: (path: string, line: string) => void = () => {}
  ) {}

  append(quote: Quote): void {
    const line = JSON.stringify({ at: this.clock.now().toISOString(), quote });
    this.lines.push(line);
    this.sync(this.path, line);
  }

  /** Called after a successful seal; the journal only holds what is not yet durable elsewhere. */
  truncate(): void {
    this.lines.length = 0;
  }

  depth(): number {
    return this.lines.length;
  }

  replay(): Quote[] {
    return this.lines.map(line => (JSON.parse(line) as { quote: Quote }).quote);
  }
}
