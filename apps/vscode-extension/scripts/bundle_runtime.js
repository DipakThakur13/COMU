#!/usr/bin/env node
/**
 * Copies the built agent runtime into the extension, then proves the copy is not stale.
 *
 * This repository has shipped a stale `dist` four separate times, each found only after it had
 * already misled someone: a test that passed against a deleted check, visual baselines recorded
 * from an old reducer, a typecheck against an old `.d.ts`, and a provider fix that was measured and
 * appeared to have no effect. The export condition in ADR 0005 fixed that for everything resolved
 * by package name inside the repository. It cannot help here, because the extension ships a
 * physical copy of the runtime bundle and a copy has no resolution step to correct.
 *
 * So the check is a timestamp comparison, and it is a hard failure rather than a warning. The
 * bundle must be newer than every source file it is built from. If it is not, packaging stops.
 */
const fs = require('fs');
const path = require('path');

const extensionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionRoot, '..', '..');

const source = path.join(repoRoot, 'apps', 'agent-runtime', 'dist', 'server.js');
const target = path.join(extensionRoot, 'server', 'index.js');

/** Directories whose sources the bundle is built from. */
const SOURCE_ROOTS = [
  path.join(repoRoot, 'packages'),
  path.join(repoRoot, 'apps', 'agent-runtime', 'src'),
  path.join(repoRoot, 'providers'),
  path.join(repoRoot, 'tools')
];

/** Not inputs to the bundle: build output, dependencies, and test material. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'tests', '__pycache__', 'coverage']);

function newestSource() {
  let newest = { file: '(none)', mtimeMs: 0 };
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|cjs|json)$/.test(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const { mtimeMs } = fs.statSync(full);
      if (mtimeMs > newest.mtimeMs) newest = { file: path.relative(repoRoot, full), mtimeMs };
    }
  };
  for (const root of SOURCE_ROOTS) walk(root);
  return newest;
}

function main() {
  if (!fs.existsSync(source)) {
    console.error(`[bundle] The runtime has not been built: ${path.relative(repoRoot, source)} does not exist.`);
    console.error('[bundle] Run: pnpm --filter @comu/agent-runtime build');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);

  const bundle = fs.statSync(target);
  const newest = newestSource();

  const bundleBuilt = fs.statSync(source).mtime;
  console.log('');
  console.log('[bundle] Runtime bundle freshness');
  console.log(`[bundle]   bundle built   ${bundleBuilt.toISOString()}  (${(bundle.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`[bundle]   newest source  ${new Date(newest.mtimeMs).toISOString()}  ${newest.file}`);

  if (bundleBuilt.getTime() < newest.mtimeMs) {
    const behindSeconds = Math.round((newest.mtimeMs - bundleBuilt.getTime()) / 1000);
    console.error('');
    console.error(`[bundle] STALE: the bundle is ${behindSeconds}s older than ${newest.file}.`);
    console.error('[bundle] Packaging stopped. Run: pnpm --filter @comu/agent-runtime build');
    process.exit(1);
  }

  const aheadSeconds = Math.round((bundleBuilt.getTime() - newest.mtimeMs) / 1000);
  console.log(`[bundle]   FRESH: built ${aheadSeconds}s after the newest source file.`);
  console.log('');
}

main();
