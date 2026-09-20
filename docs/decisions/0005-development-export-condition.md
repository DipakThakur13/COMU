# 0005. Workspace packages resolve to source through an export condition

Status: accepted
Area: build and resolution

## Problem

pnpm links workspace packages through `node_modules`, and each package's `main` and `exports` point
at its built `dist`. So any tool that resolves `@comu/protocol` by package name gets whatever was
last built, not what is on disk.

That makes correctness depend on build order, which is not a property a repository should have. It
produced four separate incidents, each found only after it had already misled someone:

- A test suite that passed with a cancellation check deleted from source, because the check was
  still present in the built output.
- A set of visual baselines generated against a stale reducer, recording a header that the current
  code does not produce.
- A typecheck that validated a consumer against an old `.d.ts`.
- A provider fix that was made, unit tested, measured by the benchmark, and found to have no effect,
  because that one package had not been rebuilt.

Each was fixed locally with an alias map, and there were four of them: one in `vitest.config.ts`,
one in the webview's `vite.config.ts`, one as `paths` in the benchmark's tsconfig, and `tsc`'s own
behaviour left unaddressed.

## Options

**1. Rebuild before anything.** A `pnpm build` in front of every check. Rejected: it is the same
convention that had already failed four times, it is slow, and nothing enforces it. "Remember to
build" is not a fix.

**2. Keep the alias maps and add one wherever it is missing.** What was happening. Rejected because
the cost is permanent and grows: an alias map is per tool and lists only the packages someone
remembered to add, so a new package silently reintroduces the problem in every tool at once, and a
new tool reintroduces it for every package.

**3. Project references.** The TypeScript-native answer, and it would fix `tsc`. Rejected as
partial: it does nothing for vitest, Vite or a `tsx` script, which is where three of the four
incidents happened.

**4. A `development` export condition declared by each package.** Chosen.

## Choice

Every workspace package declares its own source entry:

```json
"exports": {
  ".": {
    "development": "./src/index.ts",
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
}
```

Anything that wants source asks for the condition: `customConditions` in `tsconfig.base.json`,
`resolve.conditions` in the vitest and Vite configs, and `--conditions=development` for the
benchmark's `tsx` process. The four alias maps are deleted.

The published artifact is unaffected. Nothing outside the repository passes the condition, so a
consumer still resolves `dist`, and a built bundle still imports its siblings externally rather than
inlining them.

## Reasoning

**Declared by the package, not by the tool.** This is the whole point. A package knows where its
source is; a tool does not, and cannot be expected to keep a list. Moving the declaration to the
package means a new package is covered the moment it exists and a new tool is covered by asking for
one condition, so neither can reintroduce the problem by omission.

**Conditions are the mechanism the ecosystem already has for this**, understood by Node, TypeScript,
Vite and esbuild. Picking the standard mechanism means the fix keeps working as tools change,
whereas four bespoke alias maps would each need maintaining.

**The published artifact must not change.** A condition is opt-in, so the repository sees source and
everyone else sees the build. An approach that inlined siblings into `dist`, or shipped TypeScript
to consumers, would trade one silent breakage for another.

**It was verified by reproducing the original failure.** An export was added to `protocol`'s source
and `tsc`, vitest and `tsx` were each shown to see it with no build step, while a built `dist` was
confirmed to still import its siblings externally. A resolution change that is only reasoned about
is exactly the kind that fails quietly.

## Consequences

- A new workspace package must declare the condition. A package that forgets falls back to `dist`
  and reintroduces the hazard for itself, which is worth a check if it happens twice.
- Deep subpath imports of workspace packages are now blocked by the `exports` map. There were none,
  and a package that needs one should declare it rather than reaching inside.
- Tools not listed here still resolve to `dist`. Anything new that imports workspace packages has to
  pass the condition.

## See also

- `tsconfig.base.json`, `vitest.config.ts`, `apps/webview/vite.config.ts`, `benchmarks/package.json`
- [0007](0007-a-stand-in-must-behave-like-the-thing-it-replaces.md) — the same failure shape, in the test doubles
