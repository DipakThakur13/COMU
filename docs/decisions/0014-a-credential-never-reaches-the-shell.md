# 0014. The credential never reaches a command line, and everything written is checked first

Status: accepted
Area: measurement, credentials

## Problem

The benchmark needs a real provider key. A measurement against a stand-in model measures the
stand-in ([0007](0007-a-stand-in-must-behave-like-the-thing-it-replaces.md)), so there is no version
of this that avoids holding a live credential.

A key can escape in two directions, and they are not equally well defended.

**What the process writes.** The benchmark produces a result file, a markdown summary and an event
journal, and the journal contains every event of every run. Providers echo request details back in
some error messages. These files are meant to be committed, and a credential in git history is
permanent: rotating is the only remedy, and only if someone notices.

**What the operator types.** The key was passed as a command line argument. That puts it in shell
history, in the process list where every other process on the machine can read it, and in any
transcript or recording of the session. It happened twice here, in two separate transcripts, the
second time in the command that launched B0.

The second one is the one that actually leaked, and it is the one a guard inside the process cannot
do anything about. By the time `main()` runs, the key is already in the shell's history file.

## Options

**1. A key file COMU reads, with the guards on output.** Half the answer — it protects the files and
leaves the command line as it was.

**2. Prompt for the key interactively.** Rejected: it defeats running a benchmark unattended, which
is the whole point of a five-hour run, and it invites pasting into a terminal, which some terminals
log.

**3. A secret manager.** Rejected as disproportionate for a benchmark on one developer's machine,
and it would not remove the fallback path, which is where the leak happens.

**4. Refuse to run when a credential appears in argv, and read it from a gitignored file
instead — plus check everything before writing it.** Chosen.

## Choice

Three parts, covering both directions.

**Refuse at the door.** `assertNoSecretInArgv` runs before anything else in `main()`, before the
arguments are even parsed. It rejects a value matching a key shape, and it rejects the flags
`--api-key` and `--key=` regardless of their value, because an argument that is a key is a leak
whether or not this process recognises the format. The process exits rather than warning: a warning
after the shell has already recorded the history line achieves nothing.

**Read from a gitignored file.** `loadLocalEnv` reads `benchmarks/.env.local`, which `.gitignore`
covers, and sets only variables not already in the environment, so an explicitly exported key still
wins. It prints the names it loaded and never the values. There is then no reason for the key to
appear in a command at all, which is what makes the rule keepable — the alternative is remembering,
and remembering is what failed twice.

**Check everything before it is written.** `assertNoSecret` runs over the result JSON, the markdown
and each journal line before the file is touched, matching both the literal values of the known
environment variables and the *shapes* a provider key takes. Shape matching catches a key belonging
to a different environment, and one echoed back inside a provider error message. The error names the
artefact and never prints the match.

## Reasoning

**The shape patterns need a leading boundary, and that is not a detail.** Without
`(?<![A-Za-z0-9_-])`, `sk-` matches inside every task id COMU generates — `task-1789916599421-4luq1c`
contains one — and the benchmark refused to write a single result. A guard that fires on everything
is removed within a day, and then it guards nothing.

**Shapes as well as literals.** Matching only `process.env.NVIDIA_API_KEY` assumes the only key that
can appear is the one this process holds. A provider quoting the request back, or a key left in a
fixture by hand, would both pass.

**The guard cannot reach the shell, so the shell needs a different fix.** This is the part worth
remembering. The guards protect COMU's artefacts and are the visible, satisfying part of the work,
but the only credential that actually leaked did so in a place none of them can see. The fix for
that is not another check; it is removing the reason to type the key — the file — and refusing to
start if it appears anyway.

**Refusing beats warning.** A process that warns and continues has already lost: the history line
exists, and the run will be repeated with the same command because it worked.

## Consequences

- A first run needs `benchmarks/.env.local` created by hand. That friction is the intended cost, and
  the failure mode is a clear message naming the variables it looked for.
- `assertNoSecret` walks every journal line, which is the largest thing produced. Cheap next to a
  run that takes minutes, and it is the artefact most likely to contain an echoed key.
- A new provider needs its variable in `PROVIDER_KEY_VARS` and its shape in `KEY_SHAPES`. A missing
  shape is a silent gap, so it belongs in the checklist for adding a provider.
- None of this reaches the key already exposed. A credential that has appeared in a transcript is
  compromised and has to be rotated; the guards only prevent the next one.

## See also

- `benchmarks/src/secrets.ts` — `assertNoSecretInArgv`, `assertNoSecret`, `loadLocalEnv`
- [0006](0006-benchmark-grading-contract.md) — why the benchmark needs a real credential at all
