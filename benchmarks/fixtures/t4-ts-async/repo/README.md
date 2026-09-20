# catalogue-sync

Fetches catalogue rows a few at a time and builds the sync report from them. The worker pool lives
in `src/concurrency.ts`; everything that reads the catalogue goes through it.

Run the tests with `npm test`.
