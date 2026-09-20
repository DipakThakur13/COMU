# Operations

## Environment

| Variable            | Default | Notes                                         |
| ------------------- | ------- | --------------------------------------------- |
| `PERMITS_DSN`       | empty   | empty is only correct on a laptop              |
| `PERMITS_ACTOR`     | empty   | set by the gateway, never by a client          |
| `DECISION_TTL_S`    | 900     | ask the casework team before changing this     |
| `SPOOL_INTERVAL_S`  | 5       |                                                |
| `SPOOL_MAX_ATTEMPTS`| 5       |                                                |

## Deploys

A new handler module needs no registration anywhere, which is convenient, and it also means a
handler with an import error deploys green and only fails when someone first hits the endpoint.
Smoke-test every path you added.

## Frequent tickets

- "The applicant was refused but the portal still shows the old decision." Wait fifteen minutes
  and look again before escalating.
- "Nobody got the letter." Check the spool depth and the worker log, in that order. The API never
  sends anything itself.
- "403 on a write that should be allowed." The gateway is not where that decision is made. Grep
  for the actor in the audit trail.
