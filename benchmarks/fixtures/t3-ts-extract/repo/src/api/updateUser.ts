import { normalisedEmail, type UserInput } from "../types.ts";
import type { User } from "./createUser.ts";

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

export function updateUser(existing: User, input: UserInput): User {
  checkUserFields(input);
  return { id: existing.id, email: normalisedEmail(input), name: input.name.trim() };
}
