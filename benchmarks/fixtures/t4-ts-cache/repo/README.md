# pricing-service

Catalogue price, tax and shipping lookups. The lookups are pure, so they are wrapped in the small
memo helper in `src/memo.ts` to keep the hot path off the catalogue tables.

Run the tests with `npm test`.
