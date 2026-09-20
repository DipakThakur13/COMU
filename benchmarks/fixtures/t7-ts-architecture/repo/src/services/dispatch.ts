import type { Consignment, StoredConsignment } from "../domain/consignment.ts";
import type { Ledger } from "../ports/ledger.ts";
import type { Metrics } from "../telemetry/metrics.ts";
import type { Logger } from "../telemetry/logger.ts";
import type { PricingService } from "./pricing.ts";

/**
 * The write half behind the queue.
 *
 * Only the drain calls this. It prices the consignment, then appends through the Ledger port.
 */
export class DispatchService {
  constructor(
    private readonly ledger: Ledger,
    private readonly pricing: PricingService,
    private readonly metrics: Metrics,
    private readonly logger: Logger
  ) {}

  async dispatch(consignment: Consignment, dispatchedAt: string): Promise<StoredConsignment> {
    const quote = this.pricing.quote({ zone: consignment.zone, parcels: consignment.parcels });
    const stored: StoredConsignment = { ...consignment, pricedMinor: quote.minor, dispatchedAt };

    await this.ledger.append(stored);
    this.metrics.increment("dispatch.written");
    this.logger.info("dispatched", { id: consignment.id, minor: quote.minor });
    return stored;
  }
}
