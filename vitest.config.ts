import { defineConfig } from "vitest/config";

/**
 * Workspace packages resolve to source, not to their built `dist`.
 *
 * pnpm links workspace packages through node_modules and their package.json points at `dist`, so a
 * test importing a sibling by package name would exercise whatever was last built rather than what
 * is on disk. Whether a test is honest would then depend on build order, which is not a property a
 * test suite should have.
 *
 * Handled by a `development` export condition declared on every workspace package rather than an
 * alias map maintained here. An alias map is per tool, and this repository needed four of them
 * before the pattern was obvious: one for vitest, one for Vite, one for tsc and one for the
 * benchmark. A condition is declared once by the package and honoured by anything that asks for
 * it, so a new package or a new tool cannot quietly reintroduce the problem.
 */
export default defineConfig({
  resolve: {
    conditions: ["development"]
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.vscode-test/**",
      "apps/vscode-extension/src/test/**",
      // Playwright owns the visual suite; vitest would try to run it as unit tests.
      "apps/webview/tests/visual/**",
      // Benchmark fixtures are pinned sample repositories. Their tests belong to the fixture and
      // are run by the fixture's own runner inside a temporary workspace; several are meant to
      // fail, because that is the defect the fixture exists to contain.
      "benchmarks/fixtures/**"
    ]
  }
});
