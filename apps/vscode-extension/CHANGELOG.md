# Changelog

All notable changes to the COMU VS Code extension.

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
