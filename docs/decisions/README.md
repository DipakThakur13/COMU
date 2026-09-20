# Architecture decision records

Short records of the structural choices in COMU that are not obvious from the code, and that
someone would otherwise be tempted to undo.

Each record states the problem, the options that were actually considered, the choice, and the
reasoning. They are written for whoever maintains this code next, including the person who wrote
it and has forgotten why.

A record describes the decision as it was made. When a decision is replaced, add a new record and
mark the old one superseded rather than editing history: the reasoning that turned out to be wrong
is usually the most useful part.

## Index

| # | Decision | Area |
|---|---|---|
| [0001](0001-replicated-reducer-with-sequenced-events.md) | The panel holds a replica built from a snapshot plus sequenced events | Extension ↔ webview |
| [0002](0002-autonomy-model-and-scope-keys.md) | Three autonomy levels, and grants keyed by what was actually shown | Approval |
| [0003](0003-approval-semantics-and-expiry-as-denial.md) | Every way an approval can end resolves to approved or denied, never nothing | Approval |
| [0004](0004-one-required-abort-signal.md) | One required `AbortSignal`, enforced by a conformance suite over the registry | Tools |
| [0005](0005-development-export-condition.md) | Workspace packages resolve to source through an export condition | Build |
| [0006](0006-benchmark-grading-contract.md) | The benchmark grades the workspace, never COMU's own report | Measurement |
| [0007](0007-a-stand-in-must-behave-like-the-thing-it-replaces.md) | A stand-in that does not behave like the thing it replaces tests nothing | Testing practice |

## What belongs here

A decision belongs here when it constrains future work: it rules out an approach someone would
reasonably reach for, or it looks like an arbitrary complication until you know what it prevents.

Routine choices do not. Library versions, file layout and naming are recoverable from the code and
from git history, and recording them here only makes the real decisions harder to find.
