import type { StoredConsignment } from "../domain/consignment.ts";

/**
 * The storage port.
 *
 * Everything above this line talks to this interface and never to a driver. The concrete
 * implementation is chosen once, in the selector under `adapters/`.
 */
export interface Ledger {
  readonly kind: string;
  append(consignment: StoredConsignment): Promise<void>;
  byId(id: string): Promise<StoredConsignment | undefined>;
  byAccount(account: string): Promise<StoredConsignment[]>;
  count(): Promise<number>;
}
