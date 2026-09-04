import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["cjs"],
  target: "node20",
  bundle: true,
  noExternal: [/(.*)/],
  platform: "node",
  clean: false,
  sourcemap: false
});
