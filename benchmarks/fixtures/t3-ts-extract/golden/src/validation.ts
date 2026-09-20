import type { UserInput } from "./types.ts";

/** The single copy of the user field rules. Throws on the first rule the input breaks. */
export function assertUserFields(input: UserInput): void {
  const email = input.email.trim();
  if (email.length === 0) throw new Error("email is required");
  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    throw new Error("email is malformed");
  }
  const name = input.name.trim();
  if (name.length < 2) throw new Error("name is too short");
  if (name.length > 64) throw new Error("name is too long");
}
