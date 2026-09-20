import type { Chunk, Source } from "./sourceFactory.ts";
import type { Logger } from "../util/logger.ts";

/**
 * One pass over the inbox and then done. Used for backfills.
 */
export class FileSource implements Source {
  readonly kind = "file";
  private closed = false;

  constructor(
    private readonly inbox: string,
    private readonly listing: () => string[],
    private readonly readFile: (name: string) => string,
    private readonly logger: Logger
  ) {}

  async *chunks(): AsyncGenerator<Chunk> {
    for (const name of this.listing().sort()) {
      if (this.closed) return;
      this.logger.info("reading", { inbox: this.inbox, name });
      yield { name, bytes: this.readFile(name) };
    }
  }

  close(): void {
    this.closed = true;
  }
}
