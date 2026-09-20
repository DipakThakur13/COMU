# COMU Phase 3 Brief: Rebuild the Interface as a Dynamic React Application

Phases 0 and 1 landed the correctness and safety work. The agent now runs in the right directory, honours the chosen mode, enforces its permission contract, and raises real approval cards before it writes. The engine is finally worth looking at.

The interface is not. This phase replaces it.

Read `COMU_CLAUDE_CODE_BRIEF.md` for the standing engagement rules. They still apply: read before you write, no stub that presents as working, every change tested, small reviewable commits, keep the gate green.

---

## Task 0 · Finish Task 4 first (it is small now)

Do not start the rebuild with a fake approval still in the codebase, because the new interface will render approval cards and one of them would be lying.

`tools/git/src/git_push_tool.ts` still takes an `approved: boolean` in its input schema, which the **model** supplies. Remove the argument entirely and rely on the `requiresApproval: "always"` marker that `approval_gate.ts` already supports. Mark `git_commit` as `"byAutonomy"`. This should be a marker plus a deletion plus a test.

Task 5 (unifying the command execution paths, the terminal `startsWith` boundary, the Windows shell spawn) is deferred until after the rebuild. Leave it.

---

## The diagnosis: what is actually wrong with the current interface

This is not a matter of taste. Each of these is a concrete defect visible in the running product.

1. **The debug bar is still shipped.** The top row reads `COMU Boot: HTML ✓ JS ✓ DOM ✓ Render ✓ Host ... Runtime (ready) OK`. It is developer instrumentation occupying the most valuable strip of a narrow panel, and it means nothing to a user. It was flagged in the original audit and is still there.

2. **Seven tabs have degenerated into seven unlabelled emoji.** At real sidebar width the labels drop and the navigation becomes `⚡ 📊 📋 Δ 🛡️ 🧠 🤖`. Nobody can tell what those do. This is the tab overload problem predicted in the audit, arriving in its worst possible form: not crowded labels, but no labels at all.

3. **There is a stray rendering artifact** below the tab row, a blue triangle with no apparent purpose. Something is broken or orphaned in the current CSS.

4. **The composer footer is three stacked full width selects.** MODE, AUTONOMY and MODEL each take their own row, with a "Providers" link floating beside one of them. That is three rows of chrome under a single line input, and the controls dominate the thing they are meant to configure.

5. **The empty state consumes roughly forty percent of the panel.** A large hero with a logo, two headings and a three button card, in a space where the user wants to type.

6. **Text wraps badly everywhere in settings.** "OpenAI-Compatible" breaks mid word across two lines. The status pills `CLOUD · NEMOTRON` and `LOCAL / ON-DEVICE` wrap inside themselves. "GPT-6 Astra (Experiential Labs)" breaks awkwardly. The layout was never tested at the width it actually runs at.

7. **Emoji are being used as an icon system.** They render differently per platform, cannot be recoloured, cannot inherit theme tokens, and read as decoration rather than affordance.

8. **Roughly half the colours are hardcoded.** `style.css` has 23 literal hex values against 28 uses of `var(--vscode-*)`, and `index.html` carries inline hex in the boot bar. In a light theme or a high contrast theme this interface will be wrong or unreadable. It has only ever been designed for one dark theme.

9. **The primary button is a loud purple to blue gradient** that belongs to no design language in particular and certainly not to VS Code's.

Underneath all of it: `index.html` is 394 lines of hardcoded markup, `main.js` is 2,184 lines of manual `getElementById` and `innerHTML` assembly, and `style.css` is 3,145 unscoped lines. This architecture cannot express streaming text, virtualised lists, inline approval cards or animated state transitions. It has reached its ceiling.

---

## The stack

- **React 18 with TypeScript**, built by **Vite** into `apps/vscode-extension/dist/webview`.
- **Zustand** for the state store. The event to state reduction must be a **pure, unit tested reducer**, not logic scattered through components.
- **CSS Modules** for component scoped styles. No global stylesheet beyond a small token layer and a reset.
- **No component library.** VS Code webviews need to inherit the host theme, and most libraries fight that. Build the dozen primitives you need.
- **No emoji as icons.** Use inline SVG icons (Codicons are the natural fit since they are VS Code's own set and are licensed for reuse). Icons must accept `currentColor` so they inherit theme tokens.

If you have a strong case for Svelte over React on bundle size and first paint, make it before you start rather than halfway through. Otherwise React.

---

## Build integration and the development harness

**Build.** Vite produces a hashed bundle. `chat_provider.ts` currently reads `index.html` from disk and string replaces `href="style.css"` and `src="main.js"`. Replace that with generating the host HTML in TypeScript, injecting a per load **nonce** and the `webview.asWebviewUri` values for the built assets. Tighten the CSP at the same time: the current policy allows `connect-src http: https: ws:` and `script-src 'unsafe-inline'`, both of which can go once the bundle is a real file with a nonce.

**Keep the browser harness.** Your screenshots are served from `127.0.0.1:3000`, so you already have a standalone preview. Preserve and formalise it: a Vite dev server entry point with a mock `acquireVsCodeApi` shim that replays recorded event fixtures. Iterating on the interface should not require reloading an extension host. Include a fixture set covering an idle session, a running task with streaming activity, a pending approval, a completed task with changes, and a failed task.

**Theme testing.** The harness must be able to render under a light theme, a dark theme and a high contrast theme by swapping the `--vscode-*` variable set. Getting this wrong is the current interface's largest silent defect.

---

## Design system

Build a small token layer first, before any component.

- **Every colour maps to a VS Code theme variable.** `var(--vscode-editor-background)`, `var(--vscode-foreground)`, `var(--vscode-panel-border)`, `var(--vscode-button-background)`, `var(--vscode-inputValidation-errorBorder)` and so on. Zero literal hex values in component styles. If a semantic colour has no VS Code equivalent, derive it with `color-mix` from one that does.
- **Define semantic aliases** on top of those (`--comu-surface`, `--comu-surface-raised`, `--comu-border`, `--comu-text-muted`, `--comu-status-running`, `--comu-status-ok`, `--comu-status-warn`, `--comu-status-error`) so components never reach for a raw VS Code token.
- **A spacing scale and a type scale.** Four values of each is enough. The current interface has neither, which is why the vertical rhythm is inconsistent.
- **Density.** Design for a 300 pixel panel first. Everything must survive 280 pixels without horizontal scroll or mid word breaks. Test at 280, 400 and 900 (editor tab) widths.
- **Motion is functional only.** State transitions and new item arrival may animate briefly. Nothing decorative, and everything respects `prefers-reduced-motion`.

---

## Information architecture

Replace the seven tab row.

**Primary surface: the Activity stream.** Always present, never a tab you have to find. This is the product's signature view and it should never compete for space.

**Above it: a collapsible plan ribbon.** The plan renders inline as a compact progress strip showing step k of n with live status, expandable to the full step list. Not a separate destination. When Phase 2.2 makes plans model authored, this becomes the most informative element on screen.

**Beside it: two real tabs only.** Activity and Changes. Changes stays first class because review is frequent and consequential.

**Everything else into a details drawer.** Overview, Verification, Memory and Workers move into a drawer opened from the header, and each entry only appears when it has content. A Workers section with nothing in it should not be occupying navigation.

**Header.** Status, step k of n, elapsed time, and cumulative tokens and cost. The provider already returns `usage` on every `ModelResponse` and the current interface throws it away. Surfacing budget burn is one of the cheapest trust wins available.

**Composer.** One input. Collapse MODE, AUTONOMY and MODEL into a single compact control row using segmented controls or small dropdowns that sit inline, not three stacked full width selects. Autonomy in particular deserves a visible, always readable indicator, because it now governs whether the agent writes without asking.

---

## Component inventory

Build these as typed, individually testable components:

- `ActivityStream` with **virtualisation**. Long tasks emit thousands of events; do not render them all.
- `ActivityItem` variants per event class: thinking, tool call, tool result, file change, verification, diagnosis, repair, subagent, error.
- `PlanRibbon` and `PlanStepList`.
- `ApprovalCard` (see below, this is the important one).
- `DiffView` for inline preview, plus a `ChangesList` and an aggregate `ReviewAllChanges` view with per file and ideally per hunk accept or reject.
- `VerificationMatrix`, `MemoryList`, `WorkersList` for the drawer.
- `Composer` with mode, autonomy and model controls.
- `ProviderCard` and the settings surface, with the wrapping defects fixed.
- `StatusPill`, `Badge`, `Button`, `Select`, `Icon`, `EmptyState`, `Skeleton` as primitives.
- `ErrorBoundary` per major region, so one bad render cannot blank the panel.

---

## The approval card is the centrepiece

Phase 1 built a real approval gate. `approval_gate.ts` emits a typed `ApprovalRequest` carrying `kind`, the unified diff with addition and deletion counts for writes, the executable and argument vector and resolved cwd for commands, and the `sessionScopeKey` for each available grant. Nothing in the current interface renders any of that properly.

The card must:

- Show the **actual diff**, syntax highlighted, scrollable, with addition and deletion counts, for a write or an edit.
- Show the **exact command** as executable and arguments and cwd, never a joined shell string.
- Present the three scope buttons Phase 1 implemented (**this file**, **this directory**, **all writes**) with **visibly different weight**. The broad grant must not look like the narrow one. Show the `sessionScopeKey` each button will create.
- Make **Deny** always available and always safe, with a short explanation that denial returns to the agent rather than killing the task.
- Show a **countdown** when `approvalTimeoutMs` is running, because a silent expiry that denies the action would otherwise be baffling.
- Mark `git_push` distinctly, since it requires approval in every autonomy level and is never grantable for a session.
- Be reachable by keyboard, with the deny action never focused by default and never a single accidental Enter away from approving.

---

## Streaming text

There is no token level streaming anywhere in COMU. Providers accumulate deltas inside `parseStream` and return a completed `ModelResponse`, and the protocol has no delta event, so the interface has never shown text arriving.

Fix it in this phase, because a rebuilt interface where the assistant's reply appears in one block after a long pause will feel more dead than the one it replaced.

- Add a `model.token_delta` event to the protocol.
- Add an `onDelta` callback to the provider interface and emit from `parseStream` as chunks arrive.
- Render incrementally in `ActivityStream`, appending without redrawing the list.
- Keep the accumulated final response exactly as it works today; deltas are additive, not a replacement.

---

## Accessibility and keyboard

- Real focus management. Focus moves to a new approval card; focus returns sensibly when it resolves.
- Shortcuts for switching surfaces, stop, focus composer, and approve or deny a pending card. Document them in a discoverable place.
- Every icon only control gets an accessible label. The existing ARIA tablist was a decent start; go further.
- Live regions for status changes so a screen reader announces state transitions.
- Verify contrast in all three theme classes, not just the dark one.

---

## Migration plan

Do this incrementally and keep the extension working at every commit.

1. **Scaffold** Vite, React, TypeScript, the token layer and the dev harness. Nothing user visible yet.
2. **Port the reducer first.** `normalizeRawEvent` and the session state handling in `main.js` hold the real product knowledge about what each event means. Extract that into a pure typed reducer with full unit tests **before** building any component. This is the highest value and highest risk step; if the reducer is right, the components are straightforward.
3. **Build primitives and the Activity stream**, behind a setting or a build flag so the old interface still loads.
4. **Approval card, plan ribbon, changes and diff review.**
5. **Settings and provider cards**, fixing the wrapping defects.
6. **Drawer surfaces.**
7. **Reach parity, flip the default, then delete** `index.html`, `main.js` and `style.css` in a single removal commit.

Do not regress the existing startup performance suite or the frontend UI tests. Where those tests assert against the old DOM, port them rather than deleting them.

---

## Definition of done

- No hand written static HTML page, no manual DOM manipulation, no shipped debug bar.
- Every colour resolves from a theme token; the interface is correct in light, dark and high contrast.
- Nothing wraps mid word or overflows at 280 pixels.
- Navigation is comprehensible: no unlabelled emoji row.
- The activity stream virtualises and text streams in as it is generated.
- An approval card shows a real diff or a real command, with scope grants of visibly different weight.
- Tokens and cost are visible while a task runs.
- Keyboard and screen reader usable.
- Typecheck, lint, test and build all green, and the extension packages.

---

## How to proceed

1. Do Task 0 (git push marker), commit, confirm green.
2. Propose the component and state architecture, and the token layer, **before** writing components. Show me the reducer's typed state shape.
3. Then work through the migration steps, reporting at step 3 and step 7.

Ask before any architectural decision not specified here.
