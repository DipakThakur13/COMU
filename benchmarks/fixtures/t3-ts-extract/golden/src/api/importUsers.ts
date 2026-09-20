import { normalisedEmail, type UserInput } from "../types.ts";
import { assertUserFields } from "../validation.ts";

export interface ImportOutcome {
  imported: string[];
  rejected: string[];
}

/** Bulk CSV import. Operations tooling: nothing in the test suite calls it. */
export function importUsers(rows: UserInput[]): ImportOutcome {
  const outcome: ImportOutcome = { imported: [], rejected: [] };
  for (const row of rows) {
    try {
      assertUserFields(row);
      outcome.imported.push(normalisedEmail(row));
    } catch (error) {
      outcome.rejected.push((error as Error).message);
    }
  }
  return outcome;
}
