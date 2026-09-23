import { defineConfig } from "vitest/config";

/**
 * The benchmark's own tests, and nothing under `fixtures/`.
 *
 * A fixture is a pinned sample repository with its own test suite, and several of those suites are
 * meant to fail — the failing test is the defect the fixture exists to contain. They are run by the
 * fixture's runner inside a temporary workspace, never by this package's test task.
 *
 * The repository root config already excludes them, but a config is found from the working
 * directory: `pnpm -r run test` runs `vitest run` inside this package, where the root's exclusion
 * does not apply, so the aggregate task collected twenty-six fixture files and failed. That is the
 * whole of why `pnpm test` was failing at the root, and it was recorded for a release as a
 * `@vscode/test-electron` problem, which it never was.
 *
 * `development` mirrors the root: workspace packages resolve to source, not to their built `dist`.
 */
export default defineConfig({
  resolve: {
    conditions: ["development"]
  },
  test: {
    include: ["tests/**/*.test.ts"]
  }
});
