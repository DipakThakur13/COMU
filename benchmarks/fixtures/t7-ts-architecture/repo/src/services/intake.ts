import type { ReadThroughCache } from "../cache/readThroughCache.ts";
import type { Clock } from "../ports/clock.ts";
import type { Outbox } from "../queue/outbox.ts";
import type { Metrics } from "../telemetry/metrics.ts";
import type { StoredConsignment } from "../domain/consignment.ts";

export interface Receipt {
  id: string;
  acceptedAt: string;
}

/**
 * The write half of the public API.
 *
 * `accept` does no checking of its own. It mints an id, stamps the clock and enqueues; the
 * outbox decides whether the thing is a consignment at all. That is what makes 202 honest and
 * also what makes a bad payload invisible to the caller.
 */
export class IntakeService {
  private sequence = 0;

  constructor(
    private readonly outbox: Outbox,
    private readonly reads: ReadThroughCache,
    private readonly clock: Clock,
    private readonly metrics: Metrics
  ) {}

  async accept(payload: unknown, traceId: string): Promise<Receipt> {
    this.sequence += 1;
    const id = "cn-" + this.clock.now().getTime().toString(36) + "-" + this.sequence.toString(36);
    const acceptedAt = this.clock.now().toISOString();

    this.outbox.enqueue({ id, acceptedAt, traceId, payload });
    this.metrics.increment("intake.accepted");
    return { id, acceptedAt };
  }

  /** Reads go through the cache, writes do not go anywhere near it. */
  async lookup(id: string): Promise<StoredConsignment | undefined> {
    this.metrics.increment("intake.lookup");
    return this.reads.byId(id);
  }
}
