# 0012. Commands are allowed by name, git is allowed by subcommand and caller

Status: accepted
Area: command execution

## Problem

The agent can run shell commands. That is most of its usefulness — running a test suite is how it
knows whether its change worked — and it is also the largest thing it can do wrong.

An allowlist of executables is the obvious control and it is not enough on its own, because of git.
Git has to be available: `git status` and `git diff` are how the agent sees what it changed. But git
is not one command. `git status` reads; `git commit` writes history; `git push` publishes to a place
other people can see; `git reset --hard` destroys uncommitted work with no undo. Allowing "git" as
an executable allows all of them.

COMU already has governed git tools — separate tools that stage explicit paths, validate commit
messages and ask for approval. They exist precisely so a commit is deliberate. If the terminal tool
can run `git commit`, the model can reach the same outcome by shelling out, and every one of those
protections is optional in practice.

There is a second, quieter problem. A command used to be run through a shell (`shell: true`), which
means the arguments are parsed by the shell before anything sees them. `test.ts; rm -rf .` is one
argument to the caller and two commands to the shell. Any allowlist checked before that point is
checking something other than what will run.

## Options

**1. Allowlist executables only.** Rejected: it either excludes git, which removes the agent's
ability to see its own work, or includes it, which grants push and reset.

**2. Blocklist dangerous commands.** Rejected as unenumerable. `rm` is obvious; `find -delete`,
`tar` over an existing path, a test runner with a `--clean` flag are not. A blocklist is wrong the
first time someone thinks of something it does not contain, and it fails open.

**3. Ask a human for everything.** Rejected: it is the approval gate's job, not a substitute for
policy, and approving several hundred `pnpm test` invocations trains a person to approve without
reading — which is how the one that mattered gets approved too.

**4. Allowlist by executable, decide git per subcommand and per caller, and never use a shell.**
Chosen.

## Choice

`CommandPolicy.evaluate` takes a plan — executable, arguments, cwd and a `CommandSource` — and
returns ALLOW or DENY with a category and a reason. In order:

1. **Shell metacharacters are refused** in the executable or any argument: `; & | > < $ \` % ^` and
   `$(`. `%` and `^` are there for Windows, where a `.cmd` shim still has to go through `cmd.exe`,
   which expands `%VAR%` and treats `^` as an escape.
2. **Inline interpreters are refused** — `node -e`, `python -c`. They are an allowlisted executable
   with an arbitrary program as an argument, which defeats the whole list.
3. **Destructive and network executables are refused**: `rm`, `dd`, `mkfs`, `shutdown`; `curl`,
   `wget`, `ssh`, `nc`.
4. **git is decided by subcommand**, below.
5. **Allowlisted development tools are allowed**, except `npm publish` and its equivalents.
6. **Anything else is denied** and named in the reason.

Git splits three ways:

- **Read-only** (`status`, `diff`, `log`, `show`, `rev-parse`, …) — allowed to any caller, including
  a model-originated terminal call. None of them changes anything.
- **Governed** (`add`, `commit`, `push`, `checkout`, `switch`, `branch`, `restore`, `stash`) —
  allowed only when `source` is `GIT`, meaning the call came from a governed git tool with its own
  staging rules, message validation and approval. The terminal tool cannot reach these.
- **Forbidden to everyone** (`rebase`, `filter-branch`, `reflog`, `gc`, `prune`, `update-ref`,
  `cherry-pick`, `merge`, `pull`, `clone`, `config`, …), plus the argument-level ones: `reset
  --hard`, `clean`, any force push, branch or tag deletion, `stash drop`.

`CommandSource` is `AGENT | VALIDATION | EXTENSION | GIT`. It is set by the caller, not derived from
the arguments.

## Reasoning

**The unit of authority is the subcommand, not the executable.** Git is one binary and a dozen
capabilities with wildly different consequences. Any policy that treats it as one thing has to pick
the most permissive of those consequences or lose the useful ones.

**Denying by default is what makes the list a list.** An unknown executable is refused and named, so
a missing tool shows up as a clear denial someone can act on, rather than as a command that
unexpectedly worked. This is the direction the failures go in: a too-strict policy annoys, a
too-loose one destroys.

**Policy on an argument vector only means something if no shell ever sees it.** Refusing `;` and
`|` is theatre if the arguments are later handed to a shell that would have split on them anyway.
The metacharacter check and the no-shell execution are one decision, which is why they are recorded
together — either alone is a false sense of safety.

**The source is declared, not inferred.** Trying to work out "was this really the git tool" from the
arguments would be guessing at exactly the moment it matters. A caller states who it is, and the
places that may state `GIT` are the governed tools, which is a reviewable property of the code.

**This is not the approval gate and does not replace it.** Policy decides what is permitted at all;
[0002](0002-autonomy-model-and-scope-keys.md) decides what needs a human first. An allowed command
can still require approval.

## Consequences

- A legitimate command containing a shell metacharacter is refused. A test filter with a `|` in it
  has to be expressed another way. Accepted: the alternative is parsing shell syntax to decide which
  metacharacters are innocent, which is the same mistake in a more confident form.
- The allowlist needs maintaining as ecosystems are added. A new language's toolchain is denied
  until it is listed, visibly and with a reason.
- A model that wants to commit must go through the governed git tools. That is the point, and it
  means those tools have to be good enough to use.
- `config` being forbidden means the agent cannot change git settings, including to make some other
  operation succeed. Also the point.

## See also

- `tools/terminal/src/policy.ts`, `tools/terminal/src/command_plan.ts`
- [0002](0002-autonomy-model-and-scope-keys.md) — what still needs a human after policy allows it
- [0013](0013-no-shell-and-windows-shims.md) — how the argument vector survives to the process
