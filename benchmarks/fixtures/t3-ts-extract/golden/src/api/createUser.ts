import { normalisedEmail, type UserInput } from "../types.ts";
import { assertUserFields } from "../validation.ts";

export interface User {
  id: string;
  email: string;
  name: string;
}

export function createUser(input: UserInput): User {
  assertUserFields(input);
  const email = normalisedEmail(input);
  return { id: `u-${email}`, email, name: input.name.trim() };
}
