/**
 * COMU lint configuration.
 *
 * Deliberately narrow: this config exists to catch async-correctness bugs (an approval that is
 * never awaited, an async callback handed to a void listener), not to hold formatting opinions.
 * Prettier owns formatting. Every stylistic rule is off.
 *
 * Type-aware parsing (`parserOptions.project`) is required for the promise rules and is the reason
 * lint is slower than a syntax-only pass. Each workspace package has a tsconfig.json whose
 * `include` covers `src/**`, and every package's lint script runs `eslint src/`, so `project: true`
 * resolves the nearest tsconfig for each file.
 */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
    sourceType: "module",
    ecmaVersion: 2022
  },
  plugins: ["@typescript-eslint"],
  env: {
    node: true,
    es2022: true
  },
  ignorePatterns: [
    "**/dist/**",
    "**/node_modules/**",
    "**/*.js",
    "**/*.cjs",
    "**/*.mjs",
    "**/*.d.ts"
  ],
  rules: {
    // Async correctness: error.
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/await-thenable": "error",
    "no-async-promise-executor": "error",

    // Hygiene: warn.
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }
    ]
  },
  overrides: [
    {
      // Make ESLint pick up TypeScript sources when a directory is passed (default --ext is .js).
      files: ["**/*.ts", "**/*.tsx"]
    }
  ]
};
