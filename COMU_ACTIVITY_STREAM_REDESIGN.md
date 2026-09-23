# COMU Activity Stream Redesign

The Phase 3 rebuild landed structurally: the debug bar is gone, navigation is two comprehensible tabs, the plan is an inline ribbon, autonomy is selectable, the chosen mode is honoured and labelled, tokens count, and the theme is inherited rather than hardcoded. Keep all of it.

What is left is the part no amount of tokens and CSS variables fixes: **the activity stream reports the orchestrator's internal state instead of the agent's work.**

---

## What is actually on screen

A single task that made two `list_directory` calls rendered as:

```
●  Executing tools...
●  Generic started: list_directory
       list_directory
●  Generic completed: list_directory
       list_directory
●  Observing results
●  Thinking...
●  Executing tools...
●  Generic started: list_directory
       list_directory
●  Generic completed: list_directory
       list_directory
●  Observing results
●  Max execution time reached
●  Task failed: LIMIT_REACHED
```

Thirteen rows for two directory listings. Four of them print the tool name twice. Three of them ("Executing tools", "Observing results", "Thinking") are not events at all; they are the absence of an event, promoted to permanent history. One of them says "Generic", which is an internal fallback category that has escaped into the product. And the only row a user cares about, the failure and its cause, carries the same dot, the same weight and the same chevron as "Observing results".

---

## The three principles this violates

**Deference (Apple).** The interface should recede so the content leads. Here the machinery is the content and the work is buried in it. A user wants to know what the agent *did*, not which state the loop was in when it did it.

**Collapse the repetitive, elevate the exceptional (Stripe).** Identical consecutive actions should fold into one row with a count. The exception, a failure, an approval, a diff, should be visually unmistakable. Right now everything is a grey dot. Also: Stripe never ships a metric slot that renders a dead value, and `cost unknown` is a dead value taking up a third of the header's second row.

**Inherit the host's vocabulary (Microsoft Fluent).** This is an embedded surface inside VS Code. Its users already know what a file read, a diff and a test run look like. Invent as little new language as possible.

---

## The row vocabulary

One row per meaningful action, never per state transition. Each row is a single line at rest, expandable for detail. Suggested shapes, using Codicons rather than emoji:

| Action | At rest | Expanded |
|---|---|---|
| Read files | `Read 3 files · pagination.ts +2 more` | the list, each opening in the editor |
| Explore | `Explored 2 directories` | the paths and entry counts |
| Search | `Searched "fetchRecord" · 11 matches in 5 files` | grouped results, clickable |
| Edit | `Edited pagination.ts  +3 −1` | inline diff |
| Create | `Created validation.ts · 24 lines` | the content |
| Command | `npm test · 2 failed` | stdout and stderr, exit code |
| Verify | `Typecheck passed · Tests 2 failed` | the check matrix |
| Repair | `Repair attempt 1 · type error in money.ts` | the diagnosis |
| Worker | `Research worker · 4 files inspected` | its own nested stream |
| Assistant | the prose itself, streaming in | full text |

Colour carries meaning and nothing else: a failed command is the error token, a passed verification the success token, everything routine is default foreground. No row is coloured for decoration.

**Delete entirely:** `Executing tools`, `Observing results`, `Thinking`, `CLASSIFYING`, `THINKING`, `COMPLETED`, `Generic started`, `Generic completed`, and every duplicated tool name.

---

## Status belongs in a status line, not in history

"Thinking" and "Executing tools" describe what is happening *now*. They belong in a single live line pinned at the bottom of the stream that updates in place and disappears when the task ends:

```
⠋  Thinking · 12s
⠙  Running npm test · 4s
⠹  Reading src/pagination.ts
```

One line, replaced continuously, never accumulated. When the task finishes it is gone, and the history contains only things that happened.

---

## Hierarchy

Three levels, visually distinct at a glance:

1. **Outcome.** Completion, failure, or a pending approval. Full width, bordered, with the reason in plain language and an action if one exists. This should be the first thing the eye lands on when a task ends.
2. **Substance.** Edits, commands, verification results. Normal weight, an icon that means something, a metric on the right.
3. **Routine.** Reads, searches, directory listings. Dimmed, compact, collapsed into counts where consecutive.

The failure in the screenshot should look nothing like the rows above it. Right now it is a slightly redder dot.

---

## The header

Currently: `Failed · Step 1 of 3 · 5m 20s · 33.0k tokens · cost unknown`. Five values, equal weight, and one of them is dead.

Make the state the headline and the rest secondary, on one line:

```
Failed · execution limit reached
Step 1 of 3 · 5m 20s · 33.0k tokens
```

Drop `cost unknown` entirely. When a price is configured, show cost; when it is not, show nothing. An empty slot is better than a slot that says it is empty.

Rename `Nemotron 3 Ultra (Legacy)` in the model picker. "(Legacy)" on the default model reads as a warning to the person choosing it.

---

## Two specific fixes from the screenshots

**The result is printed twice.** The assistant's answer appears truncated in the stream and again in full in a RESULT panel below. Pick one. The streaming row should grow into the full answer and stay there; a separate terminal panel is redundant and costs the vertical space the panel is already short of.

**A chat turn should not render a pipeline.** A conversational reply currently produces `CLASSIFYING → Mode: CHAT → THINKING → Assistant → COMPLETED → Task completed`, six rows of machinery around one sentence of answer. In CHAT mode the stream should be the conversation and nothing else.

---

## Density

This runs in a panel roughly 350 pixels wide. Vertical space is the scarcest resource in the product and the current design spends it on repetition and on a large empty gap above the result panel. Target: a task that reads five files, makes two edits and runs the tests should fit on one screen without scrolling.

---

## What this is not

This is not a visual restyle. The colours, the type scale and the theme tokens are fine. The change is in **what gets a row at all**, and everything above can be implemented inside the existing component structure by changing the event to row reduction and adding grouping.

The reducer already normalises events; this is a second pass over that output which folds state transitions away, groups consecutive identical actions, and classifies each remaining row into one of the three hierarchy levels. The virtualised list, the theme layer and the visual regression suite all stay exactly as they are, and the snapshot baselines will need regenerating once, deliberately.
