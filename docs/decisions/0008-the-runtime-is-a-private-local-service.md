# 0008. The runtime is a private local service, and every layer assumes the others failed

Status: accepted
Area: runtime boundary and security

## Problem

The agent runtime is an HTTP server. It has to be: the VS Code extension host and the webview both
talk to it, it streams events over a long-lived connection, and it outlives any single command.

What it exposes over that HTTP surface is the whole product. `POST /v1/tasks` creates a task that
reads and writes files in a workspace and executes shell commands. There is no weaker version of
that endpoint. Anything that can reach the port can run code on the machine as the user.

The obvious implementation of a local HTTP server is the one that shipped in 0.2.4:

```js
app.use(cors());
app.listen(3456);
```

Both defaults are wrong, and wrong in a way that looks like nothing:

- `listen(port)` with no host binds every interface, not loopback. On any shared or untrusted
  network the port is reachable from other machines.
- `cors()` with no arguments sends `Access-Control-Allow-Origin: *`. A browser will then let **any
  web page the user visits** issue cross-origin requests to `127.0.0.1:3456` and read the replies.
  The page does not need to be malicious in an elaborate way; a fetch in a script tag is enough.

There was no authentication, so neither of those needed to be combined with anything else. The
result is a remote code execution surface that opens the moment the extension activates, and its
victim is the developer who installed it.

This record exists because that is not an unusual mistake. It is what you get by writing the
shortest code that works, and someone maintaining this will reach for the same two lines again.

## Options

**1. No HTTP at all: stdio or a named pipe between extension and runtime.** Genuinely the smallest
surface, and it was the strongest alternative. Rejected because the webview is a browser context
that cannot open a pipe, and the event stream is server-sent events over HTTP. Replacing it means
proxying everything through the extension host, which moves the boundary rather than removing it,
and gives up the ability to attach a second client — which is how the benchmark drives the runtime.

**2. Bind to loopback and stop there.** Rejected. Loopback keeps other machines out; it does nothing
about the browser on this machine, which is the more likely attacker and the one `cors()` invites.
Loopback alone is the mistake that reads as a fix.

**3. A token, and trust it to be enough.** Better, and still rejected as a single layer. A token can
leak through a log, a crash report or a screenshot, and if it does, a widely bound socket turns that
leak into remote access rather than local.

**4. All of them, each assuming the others failed.** Chosen.

## Choice

Four independent controls, in this order:

1. **Bound to loopback explicitly.** `startRuntimeServer` takes `LOOPBACK_HOST = '127.0.0.1'` as its
   default host and passes it to `listen`. The host is a named constant, not an inline string, so
   removing it is a visible edit rather than a forgotten argument.
2. **A loopback guard on every request.** `createLoopbackGuard` rejects any peer whose
   `remoteAddress` is not loopback, including the IPv4-mapped IPv6 forms (`::ffff:127.0.0.1`). It is
   mounted first, before CORS and before auth. This is the layer that assumes step 1 was undone.
3. **CORS closed by default.** The allowed origin defaults to `vscode-webview://` and nothing else.
   A request with no `Origin` — the extension host, the benchmark, curl — is not a browser request,
   so CORS does not apply and it is neither allowed nor blocked by this layer; it still has to pass
   the token. A request that does carry an origin is refused unless it matches.
4. **A bearer token on every route.** Compared with `timingSafeEqual` over SHA-256 digests of both
   sides, so neither the comparison nor its duration leaks the token's length or content. Started
   standalone without `COMU_RUNTIME_TOKEN`, the runtime generates 32 random bytes and prints them
   rather than running open.

## Reasoning

**Each layer is written as though the layer above it has already failed.** That is the whole design.
The loopback guard is redundant with the bind, and the bind is redundant with the guard, and that
redundancy is the point: the failure being defended against is not an attacker defeating a control,
it is a maintainer deleting one without noticing. Version 0.2.4 is the proof that this happens —
there, one missing argument and one missing argument were the entire vulnerability.

**An origin-less request is not trusted, it is out of scope for CORS.** CORS is a browser mechanism;
it constrains what a page may do with a response. It has no effect on a non-browser client and never
did. Treating a missing `Origin` as an allow would be reading CORS as authentication, which is the
mistake underneath `app.use(cors())`. The token is what authenticates.

**Defaults must be safe when the argument is forgotten.** `listen(port)` and `cors()` are both
dangerous-by-omission. Every control here is the reverse: the origin pattern defaults closed, the
host defaults to loopback, and the standalone path refuses to start without a token by making one.
Getting this wrong requires writing something, not forgetting something.

**The token is per process and never persisted.** It exists for the life of the runtime. There is no
file to leak, no reuse across sessions, and no value in stealing one after the process exits.

## Consequences

- `createRuntimeApp({ authToken: undefined })` mounts no auth middleware. That is the embedded path,
  where the caller supplies its own token — the extension host and the benchmark both do. It is a
  real hole for anything that constructs the app without a token and then serves it, so a new caller
  must pass one. The standalone entry point cannot reach this state.
- A second local client needs the token. The benchmark gets it by constructing the app itself; a
  future CLI would need it handed over deliberately, which is the intended friction.
- The published 0.2.4 build has none of this. It predates the work and remains exploitable by any
  web page for anyone who has it installed; nothing in this repository fixes an installed copy.
  Removing it from the marketplace is the only remedy that reaches those users.

## See also

- `apps/agent-runtime/src/server.ts` — `LOOPBACK_HOST`, `createLoopbackGuard`, `createAuthMiddleware`,
  `safeEqual`, `resolveStartupToken`
- [0002](0002-autonomy-model-and-scope-keys.md) — the layer above this one: what a task is allowed to
  do once it has legitimately been created
