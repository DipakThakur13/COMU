import type { Clock } from "../ports/clock.ts";
import type { DispatchService } from "../services/dispatch.ts";
import type { Logger } from "../telemetry/logger.ts";
import type { Outbox } from "./outbox.ts";

const BATCH = 32;

/**
 * The only writer to storage.
 *
 * A timer, started by main, that pulls batches off the outbox and hands each one to the
 * dispatch service. Nothing in the HTTP path waits for it, and it never touches the read cache.
 */
export function startDrain(
  outbox: Outbox,
  dispatch: DispatchService,
  clock: Clock,
  intervalMs: number,
  logger: Logger
): () => void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const batch = outbox.take(BATCH);
      for (const consignment of batch) {
        try {
          await dispatch.dispatch(consignment, clock.now().toISOString());
        } catch (error) {
          logger.error("drain_failed", { id: consignment.id, error: String(error) });
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref(): void }).unref();
  }
  return () => clearInterval(timer);
}
