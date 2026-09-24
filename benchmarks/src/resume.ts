import { providerKill, type LimitDifference, type RunRecord } from "./types.js";

export function cellKey(record: { fixtureId: string; rep: number }): string {
  return `${record.fixtureId}#${record.rep}`;
}

/** What a resumed run keeps, measures again, and skips. */
export interface ResumePlan {
  /** Cells in scope that the provider killed and `--redo-provider-failures` will measure again. */
  redo: RunRecord[];
  /** Cells not to run again, by cellKey. */
  done: Set<string>;
  /** In-scope records the resumed run keeps: the ones a budget change would be judged against. */
  standing: RunRecord[];
}

/**
 * Decides, from the journal, which cells a resumed run skips and which it measures again.
 *
 * `previous` is one record per cell, the latest. A cell the provider killed counts as done unless
 * `redoProviderFailures` is set, so the run never pays for it twice without being asked. Only cells
 * within `reps` are re-measured or judged: a rep 1 resume neither re-measures nor is judged by rep 3.
 */
export function planResume(previous: RunRecord[], reps: number, redoProviderFailures: boolean): ResumePlan {
  const inScope = previous.filter(r => r.rep <= reps);
  const redo = redoProviderFailures ? inScope.filter(r => providerKill(r) !== null) : [];
  const redoKeys = new Set(redo.map(cellKey));
  return {
    redo,
    done: new Set(previous.filter(r => !redoKeys.has(cellKey(r))).map(cellKey)),
    standing: inScope.filter(r => !redoKeys.has(cellKey(r)))
  };
}

/**
 * Whether a resumed run would measure under the budget the journal was measured under.
 *
 * A journal is one measurement only while every record in it ran under the same limits. Resuming
 * B0 without repeating its `--limits` replaced 60 steps, 25 minutes and 600 seconds per request
 * with the runtime's defaults of 30, 5 and 120, and nothing said so: ten cells died on their first
 * slow request before anyone read the log. The budget is part of the instrument, so a change to it
 * is refused unless it is asked for by name.
 *
 * Compared per fixture, because a fixture may set its own limits, and against the effective limits
 * the runtime reports back on each record rather than against the command line: an absent
 * `--limits` means the runtime's defaults, which is exactly the case that went unnoticed.
 *
 * `standing` is the records the resumed run keeps. A cell about to be measured again is replaced,
 * not joined, so the budget it was killed under does not count.
 */
export function limitDifferences(
  standing: RunRecord[],
  incomingFor: (fixtureId: string) => Record<string, number> | undefined
): LimitDifference[] {
  const seen = new Set<string>();
  const differences: LimitDifference[] = [];

  for (const record of standing) {
    const recorded = record.limits ?? {};
    // A run that never reached the runtime has no budget to compare, and says nothing either way.
    if (Object.keys(recorded).length === 0) continue;
    const incoming = incomingFor(record.fixtureId);
    if (!incoming) continue;

    for (const key of new Set([...Object.keys(recorded), ...Object.keys(incoming)])) {
      if (recorded[key] === incoming[key]) continue;
      const difference: LimitDifference = { fixtureId: record.fixtureId, key, recorded: recorded[key], incoming: incoming[key] };
      const id = `${difference.fixtureId}|${key}|${difference.recorded}|${difference.incoming}`;
      if (seen.has(id)) continue;
      seen.add(id);
      differences.push(difference);
    }
  }
  return differences;
}

/** One line per changed limit, naming the fixtures it applies to, so the change reads at a glance. */
export function describeLimitDifferences(differences: LimitDifference[]): string[] {
  const byChange = new Map<string, { key: string; recorded?: number; incoming?: number; fixtures: string[] }>();
  for (const d of differences) {
    const id = `${d.key}|${d.recorded}|${d.incoming}`;
    const entry = byChange.get(id) ?? { key: d.key, recorded: d.recorded, incoming: d.incoming, fixtures: [] };
    entry.fixtures.push(d.fixtureId);
    byChange.set(id, entry);
  }
  return [...byChange.values()].map(
    c =>
      `  ${c.key}: journal ${c.recorded ?? "unset"}, this run ${c.incoming ?? "unset"} ` +
      `(${c.fixtures.length === 1 ? c.fixtures[0] : `${c.fixtures.length} fixtures`})`
  );
}
