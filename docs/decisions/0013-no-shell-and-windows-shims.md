# 0013. No shell, ever — and what that costs on Windows

Status: accepted
Area: command execution

## Problem

`spawn(cmd, args, { shell: true })` is how most code runs a command, and it hands the arguments to a
shell to parse before the process starts. Every policy decision made before that point is made about
a different string than the one that runs. An argument of `test.ts; rm -rf .` is one argument to the
allowlist and two commands to `sh`.

So: no shell. Resolve the executable on `PATH`, spawn it directly with an argument vector, and the
arguments reach the process as written with nothing between.

On Windows that does not work, for a reason that has nothing to do with security. `npm`, `pnpm`,
`tsc`, `eslint` and every other Node tool installed on Windows are not executables. They are `.cmd`
batch shims, and `CreateProcess` cannot start a batch file. Spawning `pnpm` directly fails with
ENOENT on the platform most likely to be running this.

A batch shim can only be started through `cmd.exe`, which is the one interpreter that must not be
given anything to interpret. And `cmd.exe` has its own quoting rules, which are not Windows'
ordinary `CommandLineToArgvW` rules, which are in turn not what Node's own argument quoting
produces. Node quotes for `CreateProcess`; `cmd /c` parses before that. Letting Node quote a cmd
command line breaks any path containing a space — which is `C:\Program Files\nodejs\`, the default
Node installation.

## Options

**1. `shell: true` on Windows only.** Rejected. It makes the policy unenforceable exactly where the
majority of users are, and "secure on Linux" is not a property worth having.

**2. Refuse batch shims.** Rejected as refusing to support Windows: it would deny `pnpm test`, which
is most of what the agent needs to do.

**3. Resolve the shim's real target and spawn that.** Tempting — read `pnpm.cmd`, find the `node`
invocation inside, spawn `node` with those arguments. Rejected: it means parsing batch files,
shim formats differ between npm, pnpm, yarn and corepack, and they change between versions. It
would fail silently and in a way nobody would diagnose.

**4. Go through `cmd.exe` deliberately, with the command line quoted by us and passed verbatim.**
Chosen.

## Choice

`resolveExecutable` finds the real file on `PATH` and reports whether it is a batch shim.

For a real executable: spawn it directly, `shell: false`, Node quotes the argument vector. Nothing
else happens.

For a batch shim:

```ts
const line = [resolved.file, ...args].map(quoteForCmd).join(' ');
return { command: comspec, args: ['/d', '/s', '/c', `"${line}"`], viaCmd: true, verbatim: true };
```

with `windowsVerbatimArguments: true` on the spawn, so Node passes the line through untouched.

Each piece earns its place:

- **`/d`** skips `AutoRun`, a registry value that would otherwise run a command of someone else's
  choosing inside every shim invocation.
- **`/s` plus the outer quotes** selects the one `cmd` parsing rule that is simple: with `/s`, cmd
  strips exactly the first and last quote of the line and leaves everything between alone. Without
  it, cmd's rules for when to strip quotes depend on the content.
- **`verbatim: true`** stops Node applying `CreateProcess` quoting on top of cmd quoting. Two
  incompatible quoting schemes over one string is the bug this avoids.
- **`quoteForCmd`** follows the actual rule: a backslash is only special immediately before a quote,
  so runs of backslashes are doubled only there and at the end of the argument.
- **The policy's rejection of `%` and `^`** ([0012](0012-commands-are-allowed-by-name-and-git-by-subcommand.md))
  is what closes the remaining gap. cmd expands `%VAR%` and treats `^` as an escape, and neither
  appears in a normal development command, so refusing them costs nothing and removes cmd's
  remaining ability to reinterpret the line.

`ComSpec` is read from the sanitised environment rather than hardcoded.

## Reasoning

**cmd.exe is used as a loader, not as a shell.** It is started for one reason — a batch file cannot
be started any other way — and everything above exists to stop it doing anything else. That is a
different thing from `shell: true`, where the shell is the intended interpreter.

**Two quoting schemes over one string is the entire hazard.** The failures here were not exotic
attacks; they were `C:\Program Files` breaking a command, and then a fix that double-escaped and
broke a different one. Deciding which layer owns the quoting, and turning the other one off
explicitly, is what makes the behaviour predictable.

**`/d` is not optional.** AutoRun is a per-user registry value that runs before every cmd command.
Without `/d`, anything on the machine that sets it gets to run inside COMU's tool invocations.

**It is tested adversarially rather than reasoned about.** Quoting is where confident reasoning is
most often wrong, so the suite covers paths with spaces, embedded quotes, trailing backslashes,
backslash runs before quotes, and arguments that look like cmd syntax. During that work a `sed`-based
patch destroyed the `(\\*)` in the regex, producing a defect that took about an hour to trace to the
patch rather than the code — which is why these are never edited with anything that interprets
backslashes.

## Consequences

- Two spawn paths, and Windows is the one with the subtlety. A change to argument handling has to be
  tested on Windows specifically; the POSIX path will not show the bug.
- `quoteForCmd` is exported and directly tested, because it is the piece most likely to be quietly
  broken by a refactor.
- The policy's metacharacter rejection and this execution path are one decision in two files. A
  future relaxation of the `%`/`^` rule would reopen a hole here, and the comment in `policy.ts`
  says so.
- Nothing supports a command that genuinely needs a shell — pipelines, redirection, globbing. A tool
  that needs those has to do the work itself rather than asking a shell.

## See also

- `tools/terminal/src/executable_resolver.ts` — `resolveExecutable`, `quoteForCmd`, `buildSpawnTarget`
- `tools/terminal/src/process_manager.ts` — the spawn
- [0012](0012-commands-are-allowed-by-name-and-git-by-subcommand.md) — the policy this execution
  path is what makes enforceable
