import { normalisedEmail, type UserInput } from "../types.ts";
import { assertUserFields } from "../validation.ts";
import type { User } from "./createUser.ts";

export function updateUser(existing: User, input: UserInput): User {
  assertUserFields(input);
  return { id: existing.id, email: normalisedEmail(input), name: input.name.trim() };
}
