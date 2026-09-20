export interface UserInput {
  email: string;
  name: string;
}

export function normalisedEmail(input: UserInput): string {
  return input.email.trim().toLowerCase();
}
