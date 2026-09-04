import { RepairAttempt } from "@comu/protocol";

export class AttemptTracker {
  private attempts = new Map<string, RepairAttempt[]>();

  public recordAttempt(attempt: RepairAttempt): void {
    const list = this.attempts.get(attempt.taskId) || [];
    list.push(attempt);
    this.attempts.set(attempt.taskId, list);
  }

  public getAttempts(taskId: string): RepairAttempt[] {
    return this.attempts.get(taskId) || [];
  }

  public getAttemptCount(taskId: string): number {
    return (this.attempts.get(taskId) || []).length;
  }

  public hasIdenticalStrategy(
    taskId: string,
    failureFingerprint: string,
    repairStrategyFingerprint: string
  ): boolean {
    const list = this.attempts.get(taskId) || [];
    return list.some(
      a =>
        a.failureFingerprint === failureFingerprint &&
        a.repairStrategyFingerprint === repairStrategyFingerprint
    );
  }

  public clear(taskId: string): void {
    this.attempts.delete(taskId);
  }
}
