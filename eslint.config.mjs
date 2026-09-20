/**
 * COMU lint configuration (ESLint flat config).
 *
 * Deliberately narrow: this config exists to catch async-correctness bugs (an approval that is
 * never awaited, an async callback handed to a void listener), not to hold formatting opinions.
 * Prettier owns formatting. Every stylistic rule is off.
 *
 * Type-aware parsing (`projectService`) is required for the promise rules and is the reason lint
 * is slower than a syntax-only pass. Each workspace package has a tsconfig.json whose `include`
 * covers `src/**`, and every package's lint script runs `eslint src/`, so the project service
 * resolves the nearest tsconfig for each file.
 */
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.vscode-test/**",
      "**/*.js",
      "**/*.cjs",
      "**/*.mjs",
      "**/*.d.ts"
    ]
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      },
      ecmaVersion: 2022,
      sourceType: "module"
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin
    },
    rules: {
      // Async correctness: error.
      // checkThenables: the VS Code API returns Thenable rather than Promise; an unawaited
      // Thenable is exactly as dangerous, so include it (typescript-eslint 8 defaults it off).
      "@typescript-eslint/no-floating-promises": ["error", { checkThenables: true }],
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "no-async-promise-executor": "error",

      // Hygiene: warn.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }
      ]
    }
  }
);
