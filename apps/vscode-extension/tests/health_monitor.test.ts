import { describe, it, expect, vi, afterEach } from "vitest";
import { HealthMonitor } from "../src/runtime/health_monitor.js";

function fakeClient(sequence: Array<"connected" | "disconnected" | Error>) {
  const queue = [...sequence];
  return {
    health: vi.fn(async () => {
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (next instanceof Error) throw next;
      return { status: next } as { status: "connected" | "disconnected" };
    })
  };
}

describe("HealthMonitor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies once per status transition and awaits an async listener", async () => {
    const client = fakeClient(["disconnected", "connected", "connected", "disconnected"]);
    const seen: boolean[] = [];
    const listener = vi.fn(async (connected: boolean) => {
      await new Promise(r => setTimeout(r, 1));
      seen.push(connected);
    });
    const monitor = new HealthMonitor(client, listener);

    await monitor.check(); // disconnected (initial)
    await monitor.check(); // connected
    await monitor.check(); // connected again: no notification
    await monitor.check(); // disconnected

    expect(seen).toEqual([false, true, false]);
    expect(monitor.getConnected()).toBe(false);
  });

  it("contains a failing probe instead of rejecting", async () => {
    const client = fakeClient([new Error("ECONNREFUSED")]);
    const log = vi.fn();
    const monitor = new HealthMonitor(client, () => {}, log);
    await expect(monitor.check()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
  });

  it("contains a throwing async listener and keeps checking afterwards", async () => {
    const client = fakeClient(["connected"]);
    const log = vi.fn();
    const listener = vi.fn(async () => { throw new Error("push config failed"); });
    const monitor = new HealthMonitor(client, listener, log);
    await expect(monitor.check()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("push config failed"));
    await expect(monitor.check()).resolves.toBeUndefined();
  });

  it("does not overlap checks while a slow probe is in flight", async () => {
    let release!: () => void;
    const client = {
      health: vi.fn(() => new Promise<{ status: "connected" }>(resolve => { release = () => resolve({ status: "connected" }); }))
    };
    const monitor = new HealthMonitor(client, () => {});
    const first = monitor.check();
    const second = monitor.check();
    await second; // returns immediately, no second probe
    expect(client.health).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it("start() schedules periodic checks and stop() clears them", async () => {
    vi.useFakeTimers();
    const client = fakeClient(["connected"]);
    const monitor = new HealthMonitor(client, () => {});
    monitor.start(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.health).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.health).toHaveBeenCalledTimes(4);
    monitor.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.health).toHaveBeenCalledTimes(4);
  });
});
