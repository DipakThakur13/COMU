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
