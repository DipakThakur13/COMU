import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  external: ['vscode'],
  noExternal: ['eventsource-parser', '@comu/protocol', '@comu/provider-nvidia'],
  sourcemap: true,
  clean: false,
});
