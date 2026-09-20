import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * The webview bundle is built into the extension's dist so the packaged VSIX is self-contained.
 * Hashed filenames are resolved by the host through Vite's manifest, which is what lets the host
 * emit a strict CSP with a per-load nonce instead of string-replacing asset paths in a static
 * HTML file.
 */
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  resolve: {
    /**
     * Resolve the workspace packages to their source, not their built `dist`.
     *
     * Without this the app consumes whatever was last built, so a stale build silently changes what
     * the visual baselines capture. That happened once already: a set of baselines was generated
     * against an out-of-date reducer and recorded a header with no metrics row.
     *
     * Declared by the packages themselves as a `development` export condition rather than listed
     * here. A hand-maintained alias map only covers the packages someone remembered to add, and
     * only in the tool it was written for.
     */
    conditions: ["development"]
  },
  build: {
    outDir: resolve(__dirname, "../vscode-extension/dist/webview"),
    emptyOutDir: true,
    manifest: true,
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: resolve(__dirname, "src/main.tsx")
    }
  },
  server: {
    port: 3000,
    host: "127.0.0.1"
  }
});
