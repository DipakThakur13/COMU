import type { StoredConsignment } from "../domain/consignment.ts";
import type { Ledger } from "../ports/ledger.ts";
import type { Logger } from "../telemetry/logger.ts";
import { LedgerUnavailable } from "../domain/errors.ts";

/**
 * A decorator, not a store. Wraps whichever ledger the selector picked and retries writes with
 * a doubling backoff. Reads are not retried: a stale read is better than a slow one.
 */
export class RetryingLedger implements Ledger {
  readonly kind: string;

  constructor(
    private readonly inner: Ledger,
    private readonly attempts: number,
    private readonly logger: Logger,
    private readonly sleep: (ms: number) => Promise<void> = ms =>
      new Promise(resolve => setTimeout(resolve, ms))
  ) {
    this.kind = "retrying(" + inner.kind + ")";
  }

  async append(consignment: StoredConsignment): Promise<void> {
    let delay = 50;
    let last: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        await this.inner.append(consignment);
        return;
      } catch (error) {
        last = error;
        this.logger.warn("append_retry", { id: consignment.id, attempt });
        await this.sleep(delay);
        delay *= 2;
      }
    }
    throw new LedgerUnavailable(String(last));
  }

  byId(id: string) {
    return this.inner.byId(id);
  }
  byAccount(account: string) {
    return this.inner.byAccount(account);
  }
  count() {
    return this.inner.count();
  }
}
