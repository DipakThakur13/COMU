import type { StoredConsignment } from "../domain/consignment.ts";
import type { Ledger } from "../ports/ledger.ts";
import type { Logger } from "../telemetry/logger.ts";
import { PricingService } from "../services/pricing.ts";

interface Driver {
  execute(sql: string, params: unknown[]): Promise<Array<Record<string, unknown>>>;
}

/**
 * The carrier database.
 *
 * One thing here is not like the others: this adapter holds its own PricingService and
 * recomputes `priced_minor` on the way to the table, ignoring whatever the caller worked out.
 * It was added when a backfill wrote rows straight through the adapter with no price on them,
 * and it is the reason the storage layer imports from `services/`.
 */
export class SqlLedger implements Ledger {
  readonly kind = "sql";
  private readonly pricing: PricingService;

  constructor(
    private readonly driver: Driver,
    private readonly logger: Logger,
    tariffTable: string
  ) {
    this.pricing = new PricingService(tariffTable);
  }

  async append(consignment: StoredConsignment): Promise<void> {
    const recomputed = this.pricing.quote({
      zone: consignment.zone,
      parcels: consignment.parcels
    });
    if (recomputed.minor !== consignment.pricedMinor) {
      this.logger.warn("price_rewritten", {
        id: consignment.id,
        was: consignment.pricedMinor,
        now: recomputed.minor
      });
    }

    await this.driver.execute(
      "insert into consignments (id, account, zone, parcels, priced_minor, accepted_at, dispatched_at) values (?, ?, ?, ?, ?, ?, ?)",
      [
        consignment.id,
        consignment.account,
        consignment.zone,
        JSON.stringify(consignment.parcels),
        recomputed.minor,
        consignment.acceptedAt,
        consignment.dispatchedAt
      ]
    );
  }

  async byId(id: string): Promise<StoredConsignment | undefined> {
    const rows = await this.driver.execute("select * from consignments where id = ?", [id]);
    return rows[0] ? hydrate(rows[0]) : undefined;
  }

  async byAccount(account: string): Promise<StoredConsignment[]> {
    const rows = await this.driver.execute(
      "select * from consignments where account = ? order by accepted_at desc limit 200",
      [account]
    );
    return rows.map(hydrate);
  }

  async count(): Promise<number> {
    const rows = await this.driver.execute("select count(*) as n from consignments", []);
    return Number(rows[0]?.n ?? 0);
  }
}

function hydrate(row: Record<string, unknown>): StoredConsignment {
  return {
    id: String(row.id),
    account: String(row.account),
    zone: String(row.zone) as StoredConsignment["zone"],
    parcels: JSON.parse(String(row.parcels ?? "[]")),
    pricedMinor: Number(row.priced_minor ?? 0),
    acceptedAt: String(row.accepted_at),
    dispatchedAt: String(row.dispatched_at)
  };
}

/** Stand-in driver: the real one is injected by the deploy image. */
export function nullDriver(): Driver {
  return { async execute() { return []; } };
}
