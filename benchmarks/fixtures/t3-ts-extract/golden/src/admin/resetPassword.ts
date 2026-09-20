import { normalisedEmail, type UserInput } from "../types.ts";
import { assertUserFields } from "../validation.ts";

/** Support console action. Nothing in the test suite calls it. */
export function resetPassword(input: UserInput, token: string): string {
  assertUserFields(input);
  return `reset:${normalisedEmail(input)}:${token}`;
}
