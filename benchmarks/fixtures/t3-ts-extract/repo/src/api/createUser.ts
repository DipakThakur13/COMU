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

export interface User {
  id: string;
  email: string;
  name: string;
}

export function createUser(input: UserInput): User {
  checkUserFields(input);
  const email = normalisedEmail(input);
  return { id: `u-${email}`, email, name: input.name.trim() };
}
