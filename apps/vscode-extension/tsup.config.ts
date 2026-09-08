import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  external: ['vscode'],
  // VS Code extensions are installed without this monorepo's workspace links.
  // Bundle every runtime workspace dependency so the published VSIX is standalone.
  noExternal: [
    'eventsource-parser',
    '@comu/protocol',
    '@comu/provider-nvidia',
    '@comu/model-core'
  ],
  sourcemap: true,
  clean: false,
});
