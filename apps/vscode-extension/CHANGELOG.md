# Changelog

All notable changes to the COMU VS Code extension.

## 0.3.1 — preview

The activity stream now reports what the agent did. 0.3.0 shipped a panel that reported the
orchestrator's state machine instead: a task that made two directory listings produced thirteen
rows, four of which printed the tool's name twice, three of which were states rather than events,
and one of which said "Generic".

### Changed

- **One row per action, never per state transition.** `Executing tools`, `Observing results`,
  `Thinking`, `Generic started`, `Generic completed` and every duplicated tool name are gone. A
  tool's start and its completion are one row. A file write is reported once, by the change it
  produced, rather than once by the tool and again by the change.
- **What is happening now is a status line, not history.** One line pinned below the stream,
  replaced in place, gone when the task ends: `Reading src/pagination.ts`, `Running npm test · 4s`.
- **Rows are ranked.** An outcome is a bordered block carrying its reason in plain language, work
  that changed something is a normal row with a measurement on the right, and looking around is
  dimmed and folded: a run of reads becomes `Read 3 files · pagination.ts +2 more`, expandable,
  with each file opening in the editor.
- **A chat turn renders as the conversation and nothing else.** It used to produce six rows of
  pipeline around one sentence of answer.
- **The answer is printed once.** The reply that streams into the stream grows into its final text
  in place; the separate result panel that repeated it in full has been removed.
- **The header leads with the state and its reason** — `Failed · time limit reached` — with the
  mode, step, elapsed time and tokens secondary. `cost unknown` is gone: a model with no published
  price contributes no cost slot at all.
- The default model is listed as `Nemotron 3 Ultra` rather than `Nemotron 3 Ultra (Legacy)`, which
  read as a warning against choosing it.

### Added

- Tool events carry `target`, the one bounded string that says what a call was about: a path, a
  query, a command line. Without it an interface can only report that a tool ran, which is how
  "Generic started: list_directory" happened. The argument object is deliberately not published.
- `agent.status` carries `state`, so the state machine's own name for a transition no longer has
  to be recovered from the wording of a log message. The header said "Running" for the whole of
  every task because that inference almost never matched.
- `change.created` carries `additions` and `deletions`, counted from the same diff an approval card
  would show, so an edit made without an approval can still report its size.
- Two architecture decision records: 0016, on what earns a row in the stream, and 0017, the rule
  the three defects above have in common — meaning travels in a typed field, never in a display
  string.

### Fixed

- **`pnpm test` passes, including the VS Code integration suite.** 0.3.0 reported that suite as
  broken by a `@vscode/test-electron` incompatibility with VS Code 1.138. That was wrong. The
  launcher had been run from inside a VS Code extension host, whose environment sets
  `ELECTRON_RUN_AS_NODE=1`; that makes `Code.exe` run as plain Node, which rejects every VS Code
  flag it is handed. From an ordinary terminal the suite launches and its 12 tests pass. The
  aggregate task was also collecting the benchmark's pinned sample repositories, whose tests are
  meant to fail, because `vitest` run from that package did not see the root config's exclusion.
- The extension's own test runner pointed VS Code at `apps/` rather than at the extension, and
  worked only because VS Code went looking for a manifest inside it.
- The visual regression suite could absorb a rewritten line of text. Its tolerance was a 1% pixel
  ratio, which at 400x840 permits 3,360 changed pixels; renaming a status pill changes 144. The
  tolerance is now zero changed pixels, which is reachable because the clock is fixed rather than
  merely seeded — `clock.install` still advances, and the drifting elapsed seconds were the whole
  of the measured noise.

### Known limitations

Unchanged from 0.3.0 and listed in full in the README: polyglot repositories can be verified with
the wrong toolchain, and the repair budget is measured from the start of the task rather than the
start of repair. The benchmark baseline is still in progress; no success rate is published.

### Packaging

- Version 0.3.1 across all 24 workspace manifests, the version field alone in each.
- The runtime bundle's freshness gate is unchanged and was verified the same way as in 0.3.0, by
  making it fail: touching a source file stops packaging until the bundle is rebuilt.

## 0.3.0 — preview

First release since the engagement that rebuilt the runtime boundary, the approval gate and the
measurement harness. It is labelled a preview because the baseline that would justify calling it
anything stronger is still being measured.

### Security — read this if you have 0.2.4 installed

- **The local runtime is no longer an open server.** 0.2.4 and earlier called `app.use(cors())` and
  `app.listen(3456)` with no host and no authentication, which binds every interface and allows
  every web origin. Any page visited in a browser could create tasks that read files, write files
  and run shell commands; on a shared network, so could another machine. 0.3.0 replaces this with
  four independent controls: an explicit loopback bind, a loopback guard that refuses non-loopback
  peers with `403`, CORS closed to everything but `vscode-webview://`, and a 256-bit per-session
  bearer token compared in constant time. Each control assumes the others have failed.
- **`git push` cannot be pre-authorised.** It requires a human decision at every autonomy level,
  including `auto`, and the tool exposes no argument that would bypass it. With nobody watching the
  event stream, the push is denied.
- **An approval that expires is a denial.** Every way an approval can end resolves to approved or
  denied; none of them resolves to nothing.

### Added

- Per-task budgets. Steps, tool calls, execution time, repair attempts and the model request
  timeout are settable per task within fixed ceilings, and the resolved budget is returned on the
  task so a result always carries the conditions that produced it.
- A benchmark harness with fifteen fixtures across Python and TypeScript, graded by running the
  code and never by reading COMU's own report. Withheld tests are asserted never to reach the
  workspace.
- Architecture decision records under `docs/decisions/`, covering the runtime boundary, the
  approval semantics, cancellation, command policy and the measurement design.

### Changed

- **The rebuilt React interface is the only interface.** The legacy webview is gone and the
  `comu.ui.experimental` setting has been removed rather than left as a deprecated key.
- Retries depend on why a request failed. A timeout gets one attempt, because a request that has
  already failed to finish inside a full window will not finish inside a second one. A gateway
  refusal gets two. Authentication failures, invalid requests and cancellations get none.
- Providers send `stream_options: {include_usage: true}`, so token usage is reported for streamed
  responses instead of being silently absent.
- Workspace packages resolve to source through a `development` export condition, which removes a
  class of defect where checks passed against a stale `dist`.

### Fixed

- Every task now ends with exactly one terminal event. A run that stopped at a limit previously
  emitted nothing, so the panel spun forever and any client waiting on the stream waited until its
  own timeout.
- The terminal tool no longer spawns through a shell. Windows `.cmd` shims go through
  `cmd.exe /d /s /c` with the command line quoted by COMU and passed verbatim, so a path containing
  a space works and shell metacharacters cannot be reinterpreted.
- Git is allowed per subcommand and per caller. A model-originated terminal call can read
  repository state but cannot `commit`, `push`, `checkout` or `stash`; those belong to the governed
  git tools that carry the approval rules.

### Known limitations

Listed in full in the README. The two that will affect people most:

- A correct change can be reported as a failure in a repository containing both a `package.json`
  and a Python project, because the project type is detected from `package.json` first and the
  wrong toolchain is then used to verify.
- The repair budget is measured from the start of the task rather than the start of repair, so a
  task running longer than three minutes can be terminated with `REPAIR_TIMEOUT` — including
  read-only questions, where there is nothing to repair.

### Packaging

- The bundled runtime is rebuilt from source during packaging, and packaging fails if the bundle is
  older than the newest source file it is built from. This repository has shipped a stale `dist`
  four times; the check exists so there is no fifth.
- The package contains the extension bundle, the React interface, the runtime bundle, the icon and
  the documentation, and nothing else: no source, no source maps, no tests, no benchmark fixtures.

## 0.2.4 and earlier

Not documented here. See the security notice above: these versions should be uninstalled rather
than consulted.
