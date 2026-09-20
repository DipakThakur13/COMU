import { normalisedEmail, type UserInput } from "../types.ts";

function checkUserFields(input: UserInput): void {
  const email = input.email.trim();
  if (email.length === 0) throw new Error("email is required");
  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    throw new Error("email is malformed");
  }
  const name = input.name.trim();
  if (name.length < 2) throw new Error("name is too short");
  if (name.length > 64) throw new Error("name is too long");
}

export interface ImportOutcome {
  imported: string[];
  rejected: string[];
}

/** Bulk CSV import. Operations tooling: nothing in the test suite calls it. */
export function importUsers(rows: UserInput[]): ImportOutcome {
  const outcome: ImportOutcome = { imported: [], rejected: [] };
  for (const row of rows) {
    try {
      checkUserFields(row);
      outcome.imported.push(normalisedEmail(row));
    } catch (error) {
      outcome.rejected.push((error as Error).message);
    }
  }
  return outcome;
}
