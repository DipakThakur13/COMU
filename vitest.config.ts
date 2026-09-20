import { defineConfig } from "vitest/config";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve every workspace package to its source, not its built `dist`.
 *
 * pnpm links workspace packages through node_modules, and their package.json `main`/`exports`
 * point at `dist`. So a test that imports a sibling by package name — which is most of them, 30
 * files across the repo — exercises whatever was last built rather than what is on disk. Whether a
 * test is honest then depends on build order, which is not a property a test suite should have.
 *
 * Demonstrated before this was added: deleting the cancellation check from `read_file.ts` and
 * running the conformance suite without rebuilding left all 21 assertions passing.
 *
 * The map is built by scanning the workspace, so a package added later is covered without anyone
 * remembering, for the same reason the tool conformance suite iterates the registry.
 */
function workspaceSourceAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const group of ["packages", "tools", "providers", "apps"]) {
    const groupDir = resolve(root, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = resolve(groupDir, entry.name, "package.json");
      const indexPath = resolve(groupDir, entry.name, "src", "index.ts");
      if (!existsSync(manifestPath) || !existsSync(indexPath)) continue;
      try {
        const name = JSON.parse(readFileSync(manifestPath, "utf8")).name as string | undefined;
        if (name?.startsWith("@comu/")) aliases[name] = indexPath;
      } catch {
        // A malformed manifest is the package's own problem, not this config's.
      }
    }
  }
  return aliases;
}

export default defineConfig({
  resolve: {
    alias: workspaceSourceAliases()
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
