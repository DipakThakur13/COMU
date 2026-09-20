# 0002. Three autonomy levels, and grants keyed by what was actually shown

Status: accepted
Area: approval

## Problem

An agent that edits files and runs commands needs a supervision setting. Too much prompting and
people approve without reading, which is worse than not asking. Too little and the agent changes
things nobody agreed to.

"Approve for this session" is the pressure point. It is necessary, because approving the same
`npm test` forty times trains people to click without looking. But a session grant is a standing
permission, and its breadth decides how much a single click authorises. The question the design has
to answer is: *what exactly did the user agree to when they clicked that button?*

The first implementation keyed grants by tool name. Approving one write to `README.md` granted
`write_file` for the session, which authorised writes to every file in the workspace. Approving
`npm run build` keyed on the executable and first argument, which also authorised `npm run deploy`.
In both cases the grant was far broader than the thing the user looked at.

## Options

### Autonomy levels

**1. A boolean, supervised or not.** Rejected: there is a real third case. Asking questions about a
codebase should not require approving anything, and "read-only" is a meaningfully different promise
from "ask me first".

**2. A per-tool permission matrix.** Rejected as a configuration surface nobody will maintain
correctly. It also pushes the decision to a moment when the user has no context, rather than to the
moment the action is about to happen.

**3. Three levels: `readonly`, `ask`, `auto`.** Chosen.

### Grant scope

**1. Key by tool name.** What existed. Rejected as described: it authorises far more than was shown.

**2. Key by the exact action only.** Safe but useless. The grant would almost never match again, so
the button would not reduce prompting and people would stop using it.

**3. Offer one grant button whose breadth the system chooses.** Rejected: the user cannot tell how
much they are authorising, and the system has no basis for guessing.

**4. Offer several explicitly weighted buttons, each with its own key and its own label, and make
the user pick the breadth.** Chosen.

## Choice

**Autonomy** is one of three levels, carried per task:

| Level | Meaning |
|---|---|
| `readonly` | Mutation is refused by the tool contract. The gate is not involved. |
| `ask` | Write and execute capabilities require a human decision. |
| `auto` | No gate. The user has said in advance that they are not supervising this run. |

`readonly` is enforced by the capability contract rather than by the gate, so a tool that forgets
to consult the gate still cannot write.

**Scope keys** name what a grant covers, and the card offers the choice explicitly. For a file
write on `src/api/client.ts` the card offers three separate buttons with three distinct keys and
three distinct labels:

```
file:src/api/client.ts   Approve writes to src/api/client.ts for this session
dir:src/api/            Approve writes under src/api/ for this session
writes:*                Approve all writes for this session
```

For a command the key is the executable plus the full normalised argument vector, so `npm run build`
and `npm run deploy` are different grants. Long vectors keep the first two arguments and a count of
the rest, which still separates subcommands without letting the key grow without bound.

`git_push` offers no scope options at all. Its list is empty, so it can only ever be approved once.

Checking a grant walks the keys from most specific to least, so a `dir:` grant covers files beneath
it and `writes:*` covers everything, but only because the user chose that button by name.

A grant is valid only if its key appears in the payload the user was shown. A response naming a key
that was not offered degrades to a one-time approval rather than being honoured.

Every decision is recorded as an `approval.decided` event carrying the scope key.

## Reasoning

**The label is the specification.** A permission system is only as good as the user's model of it.
Three buttons with three sentences on them mean the user's model is correct by construction, because
the sentence they read is the rule that gets stored. A single "approve for session" button forces
the user to infer breadth, and they will infer wrong in whichever direction is more convenient.

**Breadth is the user's call, not a heuristic.** The system has no way to know whether someone is
comfortable authorising a directory or only a file. Any rule we picked would be wrong often enough
to matter, and wrong silently.

**The command key uses the full argv because the dangerous part is usually the argument.**
`npm run build` and `npm run deploy` share an executable and a subcommand and differ entirely in
consequence. Keying on anything less collapses them. The cap on long vectors is a bound on key size,
not a judgement about safety, and it deliberately keeps the first two arguments because that is
where the subcommand lives.

**`git_push` is ungrantable because it is the only irreversible action in the product.** Everything
else COMU does happens inside the workspace and can be undone with git. A push leaves the machine.
Rate-limiting the prompt is not worth the one case where it matters, so push asks every time.

**Validating the returned key closes the gap between the card and the gate.** The card and the gate
are separated by a message boundary, so the gate cannot assume the response corresponds to what was
displayed. Rejecting unoffered keys means a malformed or stale response cannot widen a grant.

**Recording the scope key makes grants auditable after the fact.** "Why did it write that file
without asking" has an answer in the journal, naming the grant and the click that created it.

## Consequences

- Adding a tool that mutates means deciding what its grant key is. The default `tool:<name>` is
  usually too broad and should be treated as a prompt to think, not as an answer.
- Scope options are computed from the payload, so a payload that does not carry a path or an argv
  cannot offer a meaningful grant.
- `auto` is a real escape hatch and is the honest answer for unsupervised runs. The alternative,
  leaving `ask` on with no observer, is covered by [0003](0003-approval-semantics-and-expiry-as-denial.md).

## See also

- `packages/agent-core/src/approval/approval_gate.ts` — `scopeOptions`, `matchingKeys`, `commandKey`
- [0003](0003-approval-semantics-and-expiry-as-denial.md) — what happens when nobody answers
