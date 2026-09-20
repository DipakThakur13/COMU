import type { Clock } from "../ports/clock.ts";
import type { Consignment } from "../domain/consignment.ts";
import type { Logger } from "../telemetry/logger.ts";
import type { Metrics } from "../telemetry/metrics.ts";
import { validateConsignment } from "../validation/validate.ts";

export interface Envelope {
  id: string;
  acceptedAt: string;
  traceId: string;
  payload: unknown;
}

export interface DeadLetter {
  id: string;
  traceId: string;
  problems: string[];
  at: string;
}

/**
 * The in-process queue between intake and dispatch.
 *
 * This is also, unexpectedly, where a payload is first checked. `enqueue` runs the schema
 * validator and quietly diverts anything that fails into the dead letter list. The caller has
 * already been told 202 by the time this runs, so a rejected consignment produces no error
 * anywhere the client can see it; it shows up as a number on /health and a line in the log.
 */
export class Outbox {
  private readonly queue: Consignment[] = [];
  private readonly dead: DeadLetter[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly metrics: Metrics,
    private readonly logger: Logger
  ) {}

  enqueue(envelope: Envelope): void {
    const result = validateConsignment(envelope.payload);
    if (!result.ok) {
      this.dead.push({
        id: envelope.id,
        traceId: envelope.traceId,
        problems: result.problems,
        at: this.clock.now().toISOString()
      });
      this.metrics.increment("outbox.dead_lettered");
      this.logger.warn("dead_letter", { id: envelope.id, problems: result.problems });
      return;
    }

    this.queue.push({ ...result.value, id: envelope.id, acceptedAt: envelope.acceptedAt });
    this.metrics.increment("outbox.enqueued");
  }

  /** Takes at most `max` entries, oldest first. */
  take(max: number): Consignment[] {
    return this.queue.splice(0, max);
  }

  pending(): number {
    return this.queue.length;
  }

  deadCount(): number {
    return this.dead.length;
  }

  deadLetters(): readonly DeadLetter[] {
    return this.dead;
  }
}
