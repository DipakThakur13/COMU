# @comu/webview

The COMU panel: React 18, TypeScript, CSS Modules, built by Vite into
`apps/vscode-extension/dist/webview`.

This is the only interface. It reached parity in 0.3.0, the legacy webview was removed, and the
`comu.ui.experimental` setting that used to choose between them is gone — there is nothing left for
it to select.

## Development harness

```bash
pnpm --filter @comu/webview dev
```

Opens at `http://127.0.0.1:3000` with a shim for `acquireVsCodeApi` that plays the extension host
for real: it reduces recorded fixture events into a `SessionState`, stamps them with sequence
numbers and delivers them exactly as the host does, so replication and gap handling are exercised
here too. Iterating on the interface never requires reloading an extension host.

Everything is in the URL, so a state worth looking at can be shared as a link:

| Parameter | Values |
| --- | --- |
| `fixture` | `idle`, `running`, `approval`, `approval-create`, `approval-command`, `approval-push`, `completed`, `chat`, `changes`, `drawer`, `failed`, `long` |
| `theme` | `dark`, `light`, `hc-dark`, `hc-light` |
| `width` | `280`, `340`, `400`, `900`, `full` |
| `speed` | `0` (instant), `40`, `120`, `400` ms between events |

For example `?fixture=approval&theme=hc-light&width=280` checks a pending approval in high
contrast light at the narrowest width the panel supports.

The harness renders the real `App` inside a resizable panel-sized frame, so what is reviewed is
what ships, at the width it actually runs at. Harness code lives in `src/dev` and is dynamically
imported, so none of it reaches the production bundle.

## Design rules

- **Every colour resolves from a VS Code theme variable.** Components use the semantic aliases in
  `src/styles/tokens.css` (`--comu-surface`, `--comu-text-muted`, `--comu-status-error`, …) and
  never a `--vscode-*` variable directly, so a theme problem is fixable in one file. `tests/
  theming.test.ts` fails the build if a literal colour or a raw VS Code variable appears in a
  component style.
- **No emoji as icons.** Icons are inline SVG from Microsoft Codicons, drawing with `currentColor`
  so they inherit their surrounding token. See `NOTICE.md` at the repository root for attribution.
- **Design for 280px first.** Nothing may break mid-word or overflow horizontally. Test at 280,
  340, 400 and 900.
- **Motion is functional only** and respects `prefers-reduced-motion`.
- **A row is something that happened.** What is happening *now* belongs to the live status line
  pinned below the stream, which is replaced in place and disappears with the task. The three row
  levels — outcome, substance, routine — are what make a failure impossible to mistake for a
  directory listing. See
  [decision 0016](../../docs/decisions/0016-the-activity-stream-reports-work-not-state.md).

## State

The panel holds a **replica**. `@comu/ui-state` is the single reducer both the extension host and
this app run, so neither re-implements what an event means, and the host can always rebuild the
replica from its own authoritative copy. See that package's README for the replication model.

## Visual regression

```bash
pnpm --filter @comu/webview test:visual          # check against the baselines
pnpm --filter @comu/webview test:visual:update   # accept intended changes
```

Playwright screenshots the panel across the full harness matrix: every fixture, in dark, light and
high contrast dark, at 280, 400 and 900 pixels. 144 baselines, committed under
`tests/visual/__screenshots__`.

This is the only check that can see the defect class the rebuild exists to fix. A hardcoded colour
that looks fine in dark and unreadable in light, a control that overflows a narrow panel, a word
broken in half: none of it is visible to typecheck, lint or a DOM assertion.

Determinism: the clock is fixed with `setFixedTime`, motion is disabled through
`prefers-reduced-motion` (which the token layer honours), fixtures are delivered instantly rather
than paced, and the suite waits for a settled signal from the harness before capturing.

**The tolerance is zero changed pixels, and nothing is masked.** It used to be a 1% pixel ratio,
which sounds strict and is not: at 400x840 that permits 3,360 changed pixels, and at 900px wide,
7,560. Measured here, renaming the status pill from "Completed" to "Finished" changes 144 pixels
and rewriting the separators on the header's second line changes 31 to 290 — every one of them
inside the old ceiling. A changed header line was in fact absorbed, and the suite reported 163
passing while the baselines no longer matched the panel.

Zero is reachable because the one thing that genuinely varied has been held still rather than
tolerated: `clock.install` seeds a clock that still advances, so the elapsed seconds in the header
and in the live status line rendered a second apart between runs. `setFixedTime` freezes them, and
three consecutive runs are then byte-identical. If something new starts varying, freeze it or
`mask` that element — raising the ceiling only buys room for changes nobody will see.

Baselines are per-platform, because system font rendering differs. Playwright names them with the
OS suffix, so a new platform runs `test:visual:update` once and commits its own set. The committed
baselines are `win32`.

Alongside the screenshots, the suite asserts three invariants that a picture alone would not catch:
nothing pushes the layout wider than 280 pixels, no label or control is allowed to break mid-word,
and no debug bar is present.
