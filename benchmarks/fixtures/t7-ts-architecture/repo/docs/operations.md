# Operations notes

## Environment

| Variable              | Default | Notes                                          |
| --------------------- | ------- | ---------------------------------------------- |
| `PORT`                | 8080    |                                                |
| `REGION`              | eu-west | `sandbox` is not a real region                 |
| `LEDGER_DSN`          | empty   | set in every deployed environment              |
| `DRAIN_INTERVAL_MS`   | 250     | lower it during a backfill                     |
| `CACHE_TTL_MS`        | 30000   | raise it only with the read-path owner's sign-off |

## Runbook: intake latency alarm

Intake latency is measured at the edge. If it climbs, the cause is almost never the
carrier database, because the edge does not wait for it. Check the drain lag metric
first, then the dead letter count.

## Runbook: "the consignment I just created is not there"

Support raises this roughly once a week. Ask for the trace id from the response
header and grep the drain log for it before escalating.
