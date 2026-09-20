import fs from "node:fs";
import path from "node:path";
import type { Settings } from "../config/settings.ts";
import type { Logger } from "../util/logger.ts";
import { FileSource } from "./fileSource.ts";
import { PollingSource } from "./pollingSource.ts";

export interface Chunk {
  name: string;
  bytes: string;
}

export interface Source {
  readonly kind: string;
  chunks(): AsyncGenerator<Chunk>;
  close(): void;
}

/**
 * Picks the source implementation.
 *
 * `watchIntervalMs` of zero is not "poll as fast as you can"; it is the switch that turns the
 * whole thing into a one-shot FileSource, which is how backfills are run. Everything downstream
 * is identical either way, so the only visible difference is whether the process exits.
 */
export function createSource(settings: Settings, logger: Logger): Source {
  const inbox = settings.profile.inbox;
  const listing = () => (fs.existsSync(inbox) ? fs.readdirSync(inbox) : []);
  const readFile = (name: string) => fs.readFileSync(path.join(inbox, name), "utf8");

  const source: Source =
    settings.watchIntervalMs > 0
      ? new PollingSource(inbox, settings.watchIntervalMs, listing, readFile, logger)
      : new FileSource(inbox, listing, readFile, logger);

  logger.info("source_selected", { kind: source.kind, inbox, intervalMs: settings.watchIntervalMs });
  return source;
}
