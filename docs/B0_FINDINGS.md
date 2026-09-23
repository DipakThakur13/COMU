# B0 findings

Found while running and investigating the B0 baseline, 2026-09-20 to 2026-09-23. The product defects
are fixed after B0, because B0 measures the product as shipped.

## Product defect: the NVIDIA model selection never reaches the provider

**Fix before the next release, after B0.**

The user chooses a model in the composer's model picker (defaulting to the `comu.defaultModel`
setting). The extension sends it as `modelId` with the prompt, and the runtime passes it through
`selectProvider` into `defaultProviderFactory` (apps/agent-runtime/src/server.ts). For Ollama and
OpenAI-compatible providers the factory passes `modelId` to the provider. For NVIDIA it does not:

```ts
return new NvidiaProvider(nvidiaKey, nvidiaEndpoint);
```

With no model argument, `NvidiaProvider` keeps its built-in default, `selectedModel =
"nvidia/nemotron-3.5-lightning-30b-a3b"` (providers/nvidia/src/index.ts). `generate` uses
`request.model || this.selectedModel`, and the orchestrator sets no `request.model`. So every NVIDIA
request goes to Lightning 30B-A3B, whatever the user picked. Nothing reports this: the task
proceeds, the model picker still shows the choice, and only the `model` field on
`model_request.succeeded` events reveals what actually served.

This is the same class as the dropped mode selector: a user's choice is accepted by the interface
and discarded on the way to the thing it was meant to control.

Evidence: every one of B0's model requests went to Lightning 30B-A3B (215 in the first session's
console log and 8 in the first resume's, 223 counted on 2026-09-23), while the run was launched with
`--model nvidia/nemotron-3-ultra-550b-a55b` and every record names Ultra.

Beyond the one-line fix, the choice should be checked end to end: a test that selects a
non-default NVIDIA model and asserts the model in the outgoing request body. It should not assert
on the `model` field of the event, which is where the discrepancy was visible, not what caused it.

## Finding: verification requiredness comes from prompt prose and file extensions, not the contract

Fifth instance of decision 0017 (three recorded there, plus the predicted `astra` name sniffing), and
the first that fails tasks instead of mislabelling the interface.

The contract already carries the answer. `AgentKernel.createContract`
(packages/agent-core/src/agent_kernel.ts) sets `expectedMutation` and `verificationRequired`: false
for ASK/PLAN and for `autonomy: "readonly"`, true for AGENT. **No production code reads either
field.** The only reader is packages/agent-core/tests/kernel/explicit_mode.test.ts.

What decides verification instead:

- `Planner.classify` (packages/planning-engine/src/planner.ts) picks steps from words in the prompt
  ("add", "test", "fix", ...). It takes no mode, so any prompt that isn't a question gets a VALIDATE
  step.
- `VerificationPolicy.determinePlan` (packages/verification-engine/src/verification_policy.ts)
  skips checks when the prompt *starts with* "explain", "what", "how" and so on, and otherwise makes
  checks required from `promptLower.includes("test" | "fail" | "fix")` and from `.ts`, `.test.` and
  `package.json` in the changed paths.
- Only the state machine consults the mode, and too late: it forbids REPAIRING outside AGENT
  (orchestrator.ts), so a read-only task that fails a check it should never have run can only end in
  failure.

### Face 1: T7 verifies what it must not

ASK + readonly, so the contract says `verificationRequired: false`. The prompt starts "You have
just been handed this repository", not a question word, so the policy runs typecheck, tests and
build against an unchanged repo. The untouched t7-ts-architecture and t7-ts-dataflow repos fail
their own typecheck (TS5097; their tsconfigs lack `allowImportingTsExtensions`), and `tsc -p` also
writes `dist/`. The run then ends with `REPAIR_TIMEOUT` (the repair clock starts at task start, so
it fires with 0 attempts past 180 s), and the rubric scores the error string. Peak context in the T7
records was 1.7–5.2% of 128k, so this is not a capability result.

### Face 2: t2-py-validator verifies nothing new and calls it success

B0's one false completion (rep 2). This corrects the first reading, which said the required set was
empty and `every([])` returned true. The record says otherwise:

- The prompt contains "The existing **tests** in orders/test_validation.py pass today", so
  `isTestTask` is true and Test Suite is **required**.
- The verification event (results/B0.console.log, task-1789936332755-y140a1, 20:50:12Z) reads
  "Verification PASSED: **1 passed**, 3 skipped" in 1009 ms: pytest ran and passed.
- The required set was not empty. It held the one check that could not fail: the existing suite
  that the prompt itself says passes today. The spec's new behaviour is covered only by
  `withheld/tests/test_validate_order.py`, which the agent's workspace never contains. So a green
  required check was the baseline state, not evidence about `validate_order`. 14 of 15 must-pass
  tests passed; `test_items_must_be_a_non_empty_list` did not.
- The completion gate then accepted a final message that was ~10k characters degenerating into
  "matrix", produced by a request that hit its 16,384-token cap (completionTokens 16384, latency
  524 s).
- The `every([])` path is real but latent. It needs every rule to be optional, which is the
  informational prompt path, and no PASSED verification in B0 has "0 passed". It did not cause this
  record.

The common cause: whether to verify, and what counts as evidence, is recovered from wording. The
typed fields that already hold the answer are not read. The correction belongs to the producer (the
contract), per 0017, not to better prompt patterns.

## Benchmark limitation: the T1–T4 typecheck signal carries no information

The TypeScript fixtures in T1–T4 declare their typecheck as
`node --experimental-strip-types --check <file>`. In Node 22.14, `node --check` exits 0 on any file
containing an `export` statement without checking it. The same broken file without `export` fails
as expected. Every fixture module exports, so the script passes whatever the file contains; checked
by appending a syntax error to t1-ts-currency's `src/money.ts`, which still exited 0.

COMU's verification resolves its typecheck to that script, so in B0 a passing typecheck on T1–T4
says nothing about the code. Correctness is unaffected, because the grader runs the fixtures' tests
and never the typecheck. What is lost is any reading of COMU's own verification behaviour through
the typecheck on those tiers. This is stated as a limitation in the B0 report.

Related: verification resolves `tsc` from the PATH the bench inherits (`pnpm bench` adds
`node_modules/.bin`). Outside that environment, `tsc` does not exist in a workspace.

## Benchmark fixture: T7 TypeScript repos fail their own typecheck

Both t7-ts-architecture and t7-ts-dataflow fail `tsc` in their untouched state: TS5097 on every
`.ts` import, and, once that is allowed, missing Node types, because bench workspaces have no
`node_modules`. The fix, verified on a copy of t7-ts-architecture, is `allowImportingTsExtensions`
and `noEmit` in the tsconfig, plus a small ambient declaration of the four Node APIs the fixture
uses. With it, real `tsc` exits 0, no `dist/` is written, the fixture's 11 tests pass, and an
injected type error fails the check.

**Applied after B0 lands, to both TypeScript fixtures, not mid-run.** Records carry no fixture
hash, and a fixture that changes partway through one baseline is worse than eleven documented zeros.

## After B0: do not act on these yet

1. **A repetition-ratio guard on completion.** A final message whose token n-gram repetition passes
   a threshold, or one that ends at the `max_tokens` cap, cannot complete a task. t2-py-validator
   rep 2 is the case: capped at 16,384 tokens, mostly "matrix". Measure the ratio on B0's final
   messages first, so the threshold separates the real answers from the collapses already on
   record (t2-py-validator #2, t4-ts-cache #2, t7-py-architecture #2, t3-py-rename #2 and others).
2. **Temperature for Nemotron.** Correction to the premise: the collapse did not happen at 0.1. The
   model that ran is Lightning 30B-A3B, whose profile default is temperature **1** with
   `maxTokens` 16,384 (providers/nvidia/src/catalog.ts); the orchestrator sets no temperature. The
   0.1 belongs to Ultra 550B, which B0 never reached. So B0's evidence is repetition collapse on a
   small reasoning model at temperature 1 running to its token cap. What's worth testing, once the
   model selection reaches the provider: Ultra at its 0.1 default against something higher (the
   original question, still untested), and Lightning with a reasoning budget or `max_tokens` well
   below 16,384 so a collapse ends early rather than at 8+ minutes.
