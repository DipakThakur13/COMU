import type { StoredConsignment } from "../domain/consignment.ts";
import type { Ledger } from "../ports/ledger.ts";

/** Process-local storage. Used in sandbox and in the tests. */
export class MemoryLedger implements Ledger {
  readonly kind = "memory";
  private readonly rows = new Map<string, StoredConsignment>();

  async append(consignment: StoredConsignment): Promise<void> {
    this.rows.set(consignment.id, consignment);
  }

  async byId(id: string): Promise<StoredConsignment | undefined> {
    return this.rows.get(id);
  }

  async byAccount(account: string): Promise<StoredConsignment[]> {
    return [...this.rows.values()].filter(row => row.account === account);
  }

  async count(): Promise<number> {
    return this.rows.size;
  }
}
