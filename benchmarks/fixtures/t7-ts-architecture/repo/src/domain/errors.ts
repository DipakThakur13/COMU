import type { Response } from "../http/router.ts";

export class DomainError extends Error {
  constructor(readonly code: string, message: string, readonly status = 422) {
    super(message);
  }
}

export class RejectedPayload extends DomainError {
  constructor(readonly problems: string[]) {
    super("rejected_payload", problems.join("; "), 422);
  }
}

export class LedgerUnavailable extends DomainError {
  constructor(cause: string) {
    super("ledger_unavailable", cause, 503);
  }
}

export function toResponse(error: unknown): Response {
  if (error instanceof DomainError) {
    return { status: error.status, headers: {}, body: { error: error.code, detail: error.message } };
  }
  return { status: 500, headers: {}, body: { error: "internal" } };
}
