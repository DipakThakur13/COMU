import fs from "node:fs";
import path from "node:path";
import { isAlive, latestPerCell, readJournal, readRunLock } from "./report.js";
import { cellKey } from "./resume.js";
import { providerKill } from "./types.js";

/**
 * `bench --status`: how a run is doing, from a shell that did not start it.
 *
 * A measurement is launched detached so that it outlives the shell that started it; B0 died at 31
 * of 75 cells and B1 at 2 of 15 because it did not. The price is that nobody is watching its
 * console, so this answers from what the run leaves on disk: the lock (its pid and what this launch
 * is doing) and the journal (what has been measured). Nothing here needs a key or takes the lock.
 */
export interface StatusInput {
  outDir: string;
  label: string;
  /** Every cell in scope for the label, by cellKey: fixtures times repetitions. */
  scope: string[];
  now?: Date;
}

export function describeStatus({ outDir, label, scope, now = new Date() }: StatusInput): string[] {
  const lines: string[] = [];
  const lock = readRunLock(outDir, label);
  const alive = lock ? isAlive(lock.pid) : false;

  if (!lock) {
    lines.push(`${label}: no run is going (no lock).`);
  } else if (!alive) {
    lines.push(`${label}: NOT RUNNING. The lock names pid ${lock.pid}, which is not alive: the run died without releasing it.`);
  } else {
    lines.push(`${label}: running, pid ${lock.pid} is alive.${lock.startedAt ? ` Launched ${lock.startedAt}, ${ago(lock.startedAt, now)}.` : ""}`);
  }

  if (lock && lock.planned.length > 0) {
    const finished = new Set(lock.finished);
    const inFlight = lock.inFlight.filter(c => !finished.has(c.cell));
    const notStarted = lock.planned.filter(c => !finished.has(c) && !inFlight.some(f => f.cell === c));
    lines.push(
      `This launch: ${finished.size} of ${lock.planned.length} cells finished, ${inFlight.length} in flight, ${notStarted.length} not started.`
    );
    for (const cell of inFlight) lines.push(`  in flight: ${cell.cell}, started ${ago(cell.startedAt, now)}`);
  }

  const inScope = new Set(scope);
  const records = latestPerCell(readJournal(outDir, label)).filter(r => inScope.has(cellKey(r)));
  const killed = records.filter(r => providerKill(r) !== null);
  lines.push(
    `Journal: ${records.length} of ${scope.length} cells in scope recorded, ${records.length - killed.length} measured` +
      (killed.length > 0 ? `, ${killed.length} ended by the provider (measured again only under --redo-provider-failures)` : "") +
      `; ${scope.length - records.length} without a record.`
  );

  const last = [...records].sort((a, b) => finishedAt(b) - finishedAt(a))[0];
  if (last) lines.push(`Last record: ${last.fixtureId} rep ${last.rep}, finished ${ago(new Date(finishedAt(last)).toISOString(), now)}.`);

  const log = path.join(outDir, `${label}.console.log`);
  if (fs.existsSync(log)) lines.push(`Console log ${path.basename(log)} last written ${ago(fs.statSync(log).mtime.toISOString(), now)}.`);

  return lines;
}

function finishedAt(record: { startedAt: string; durationMs: number }): number {
  return Date.parse(record.startedAt) + record.durationMs;
}

function ago(iso: string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (seconds < 120) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 120 ? `${minutes}m ago` : `${(minutes / 60).toFixed(1)}h ago`;
}
