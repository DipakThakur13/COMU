import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.vscode-test/**",
      "apps/vscode-extension/src/test/**"
    ]
  }
});
