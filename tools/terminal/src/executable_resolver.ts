import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolves an executable name to a concrete file, so commands can be spawned without a shell.
 *
 * COMU used to spawn with `shell: process.platform === 'win32'`, which handed the whole command
 * line to cmd.exe. The policy filters shell metacharacters, but cmd also performs `%VAR%`
 * expansion and caret escaping that the filter did not cover. Resolving the executable ourselves
 * removes the reason the shell was there in the first place.
 */

export type ResolvedKind = 'executable' | 'batch' | 'unresolved';

export interface ResolvedExecutable {
  /** Absolute path when resolution succeeded, otherwise the name as given. */
  file: string;
  kind: ResolvedKind;
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** Windows batch shims (npm, pnpm, yarn, tsc, eslint, …) cannot be executed by CreateProcess. */
export function isBatchFile(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return ext === '.cmd' || ext === '.bat';
}

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATH ?? env.Path ?? env.path ?? '';
  return raw.split(path.delimiter).filter(Boolean);
}

function candidateNames(name: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') return [name];
  if (path.extname(name)) return [name];
  const exts = (env.PATHEXT ?? DEFAULT_PATHEXT).split(';').filter(Boolean);
  // Prefer a real executable over a batch shim: it can be spawned with no interpreter at all.
  const ordered = [...exts].sort((a, b) => rank(a) - rank(b));
  return ordered.map(ext => `${name}${ext.toLowerCase()}`);
}

function rank(ext: string): number {
  const lower = ext.toLowerCase();
  if (lower === '.exe' || lower === '.com') return 0;
  if (lower === '.cmd' || lower === '.bat') return 2;
  return 1;
}

/**
 * Looks the executable up on PATH. An absolute or relative path is used as given. Returns
 * `unresolved` rather than throwing, so the caller can still attempt the spawn and surface the
 * operating system's own ENOENT.
 */
export function resolveExecutable(name: string, env: NodeJS.ProcessEnv = process.env): ResolvedExecutable {
  if (!name) return { file: name, kind: 'unresolved' };

  const explicit = name.includes('/') || name.includes('\\');
  const roots = explicit ? [path.dirname(path.resolve(name))] : pathEntries(env);
  const base = explicit ? path.basename(name) : name;

  for (const dir of roots) {
    for (const candidate of candidateNames(base, env)) {
      const full = path.join(dir, candidate);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          return { file: full, kind: isBatchFile(full) ? 'batch' : 'executable' };
        }
      } catch {
        // Unreadable entry on PATH: keep looking.
      }
    }
  }

  return { file: name, kind: 'unresolved' };
}

export interface SpawnTarget {
  command: string;
  args: string[];
  /** True when cmd.exe is the process being started, for a batch shim. */
  viaCmd: boolean;
  /**
   * True when `args` is already a fully quoted command line that Node must pass through untouched.
   * Only ever set for the cmd.exe path.
   */
  verbatim: boolean;
}

/**
 * Quotes one argument for cmd.exe.
 *
 * Backslashes are only special immediately before a quote, which is the rule this follows. The
 * policy separately rejects `%` and `^`, so expansion and caret escaping cannot reach here.
 */
export function quoteForCmd(value: string): string {
  const escaped = value
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, '$1$1');
  return `"${escaped}"`;
}

/**
 * Turns an executable and its arguments into what to actually spawn, never using `shell: true`.
 *
 * A real executable is spawned directly, with Node quoting the arguments. A Windows batch shim has
 * to go through cmd.exe because CreateProcess cannot run one; there the whole command line is
 * quoted here and passed verbatim, because `cmd /s /c` strips exactly the outer pair of quotes and
 * leaves the rest alone. Letting Node quote instead breaks any shim whose path contains a space,
 * which is every default Node installation on Windows.
 */
export function buildSpawnTarget(executable: string, args: string[], env: NodeJS.ProcessEnv = process.env): SpawnTarget {
  const resolved = resolveExecutable(executable, env);

  if (resolved.kind === 'batch') {
    const comspec = env.ComSpec ?? env.COMSPEC ?? 'cmd.exe';
    const line = [resolved.file, ...args].map(quoteForCmd).join(' ');
    return { command: comspec, args: ['/d', '/s', '/c', `"${line}"`], viaCmd: true, verbatim: true };
  }

  return { command: resolved.file, args, viaCmd: false, verbatim: false };
}
