import fs from "node:fs";
import path from "node:path";

/**
 * Keeping the provider key out of everything the benchmark writes down.
 *
 * The key reaches the runtime from this process's environment and goes nowhere else. It is never a
 * command line argument, because an argument is visible to every other process on the machine and
 * lands in shell history. Results and the event journal are checked before anything is written,
 * because a benchmark result is meant to be committed and a leaked key in git history is permanent.
 */

/** Environment variables the runtime reads a provider credential from. */
export const PROVIDER_KEY_VARS = ["NVIDIA_API_KEY", "EXPERIENTIAL_API_KEY", "OPENAI_API_KEY"] as const;

/**
 * Shapes a provider key takes, independent of whether this process happens to hold one.
 *
 * Checked alongside the literal values so that a key belonging to some other environment, or one
 * echoed back by a provider in an error message, is still caught.
 */
const KEY_SHAPES = [
  // The leading boundary is load-bearing. Without it, "sk-" matches inside every task id COMU
  // generates ("task-1789916599421-4luq1c"), and the benchmark refuses to write any result at all.
  /(?<![A-Za-z0-9_-])nvapi-[A-Za-z0-9_-]{16,}/,
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/,
  /(?<![A-Za-z0-9_-])exp-[A-Za-z0-9_-]{16,}/
];

/**
 * Loads credentials from a gitignored file so they never appear in a command.
 *
 * The guards below protect what COMU writes. They cannot reach the shell, and the shell is the
 * only place a key has ever actually leaked here: typed inline on a benchmark invocation, it lands
 * in shell history, in the process list, and in any transcript of the session. Reading it from a
 * file removes the opportunity rather than relying on remembering.
 *
 * An existing environment variable always wins, so an explicitly exported key is never overridden.
 */
export function loadLocalEnv(startDir: string): string[] {
  const loaded: string[] = [];
  const candidates = [path.join(startDir, ".env.local"), path.join(startDir, "..", ".env.local")];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const name = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!name || process.env[name] !== undefined) continue;
      process.env[name] = value;
      // The name only. Printing the value would defeat the point of the file.
      loaded.push(`${name} (from ${path.basename(path.dirname(file))}/.env.local)`);
    }
  }
  return loaded;
}

export class SecretLeakError extends Error {}

/** The literal credential values this process holds, longest first so the longest match wins. */
export function providerSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return PROVIDER_KEY_VARS.map(name => env[name])
    .filter((value): value is string => typeof value === "string" && value.trim().length >= 8)
    .map(value => value.trim())
    .sort((a, b) => b.length - a.length);
}

/**
 * Refuses to start if a credential was passed on the command line.
 *
 * Catches both a literal key and the flags someone would reach for to pass one, so the failure
 * names the mistake rather than silently ignoring an argument that looks like it should work.
 */
export function assertNoSecretInArgv(argv: string[], env: NodeJS.ProcessEnv = process.env): void {
  const secrets = providerSecrets(env);
  const offenders: string[] = [];

  for (const arg of argv) {
    if (secrets.some(secret => arg.includes(secret))) offenders.push("an argument contains a credential from the environment");
    if (KEY_SHAPES.some(shape => shape.test(arg))) offenders.push("an argument looks like a provider key");
    if (/^--(api-?key|key|token|secret)(=|$)/i.test(arg)) offenders.push(`'${arg.split("=")[0]}' is not accepted`);
  }

  if (offenders.length > 0) {
    throw new SecretLeakError(
      [
        "The benchmark takes its provider credential from the environment only.",
        ...new Set(offenders),
        `Set one of ${PROVIDER_KEY_VARS.join(", ")} instead.`
      ].join("\n  ")
    );
  }
}

/**
 * Fails rather than writing anything that contains a credential.
 *
 * Deliberately not a redactor. Quietly masking would leave the benchmark believing its output is
 * clean while the path that produced it stays broken; refusing makes the leak someone's problem
 * the first time it happens.
 */
export function assertNoSecret(payload: unknown, where: string, env: NodeJS.ProcessEnv = process.env): void {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload) ?? "";
  if (!text) return;

  const secrets = providerSecrets(env);
  if (secrets.some(secret => text.includes(secret))) {
    throw new SecretLeakError(`A provider credential from the environment appears in ${where}. Nothing was written.`);
  }

  const shape = KEY_SHAPES.map(pattern => pattern.exec(text)).find(Boolean);
  if (shape) {
    // Reported by shape and position only; printing the match would put it in the terminal scroll
    // back and in CI logs, which is the thing being prevented.
    throw new SecretLeakError(
      `Something shaped like a provider key appears in ${where} at offset ${shape.index}. Nothing was written.`
    );
  }
}
