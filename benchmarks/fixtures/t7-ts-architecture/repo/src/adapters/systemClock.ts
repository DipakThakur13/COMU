import type { Clock } from "../ports/clock.ts";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  ticks(): number {
    return Date.now();
  }
}

/** Used by the tests; never wired by the container. */
export class FrozenClock implements Clock {
  constructor(private instant: Date) {}
  now(): Date {
    return new Date(this.instant.getTime());
  }
  ticks(): number {
    return this.instant.getTime();
  }
  advance(ms: number): void {
    this.instant = new Date(this.instant.getTime() + ms);
  }
}
