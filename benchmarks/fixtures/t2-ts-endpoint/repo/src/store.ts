/**
 * An in-memory users-and-orders store.
 *
 * Everything handed out is a copy: callers hold values, never the store's own records.
 */

export type OrderStatus = "pending" | "shipped" | "cancelled";

export interface User {
  id: string;
  name: string;
}

export interface Order {
  id: string;
  userId: string;
  status: OrderStatus;
  /** Whole currency units. */
  total: number;
  /** An ISO-8601 calendar date, YYYY-MM-DD. */
  placedAt: string;
}

const users = new Map<string, User>();
const orders = new Map<string, Order>();

/** Empties the store. */
export function reset(): void {
  users.clear();
  orders.clear();
}

export function addUser(user: User): User {
  if (users.has(user.id)) throw new Error(`duplicate user: ${user.id}`);
  users.set(user.id, { ...user });
  return { ...user };
}

export function getUser(id: string): User | undefined {
  const found = users.get(id);
  return found ? { ...found } : undefined;
}

export function addOrder(order: Order): Order {
  if (!users.has(order.userId)) throw new Error(`unknown user: ${order.userId}`);
  if (orders.has(order.id)) throw new Error(`duplicate order: ${order.id}`);
  orders.set(order.id, { ...order });
  return { ...order };
}

/** Every order in the store, newest first. */
export function listOrders(): Order[] {
  return [...orders.values()].sort(byNewestFirst).map(order => ({ ...order }));
}

/** Newest first by placement date; ties broken by ascending id so the order is total. */
function byNewestFirst(a: Order, b: Order): number {
  if (a.placedAt !== b.placedAt) return a.placedAt < b.placedAt ? 1 : -1;
  return a.id < b.id ? -1 : 1;
}
