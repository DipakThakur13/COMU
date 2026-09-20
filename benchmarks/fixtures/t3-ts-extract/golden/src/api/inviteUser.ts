import { normalisedEmail, type UserInput } from "../types.ts";
import { assertUserFields } from "../validation.ts";

export interface Invitation {
  to: string;
  subject: string;
}

export function inviteUser(input: UserInput): Invitation {
  assertUserFields(input);
  return { to: normalisedEmail(input), subject: `${input.name.trim()}, you are invited` };
}
