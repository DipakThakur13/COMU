export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  constructor(private instant: Date) {}
  now(): Date {
    return new Date(this.instant.getTime());
  }
  advance(ms: number): void {
    this.instant = new Date(this.instant.getTime() + ms);
  }
}
