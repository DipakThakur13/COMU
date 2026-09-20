export interface Clock {
  now(): Date;
  /** Milliseconds from a monotonic source, for durations. */
  ticks(): number;
}
