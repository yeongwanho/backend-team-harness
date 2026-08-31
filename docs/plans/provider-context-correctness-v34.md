# v34 — correct adjacent tests before reducing small-task input

## Scope and completion evidence

This is one increment of the active 3-backend/20-task goal, not completion of it.
The v33 FastAPI pair passed but BTH was slower and supplied more input. Its
request also recommended empty Python initializers as production/test pairs.
Do not trade away policy, custom human instructions, or verification to reduce
bytes. Keep v33 observations and unsuccessful new observations.

1. `src/core/convention-compiler.mjs`, `test/convention-compiler.test.mjs`:
   failing-first tests for Python test prefixes, initializer exclusion, duplicate
   names across modules/packages, ambiguous ties, duplicate declarations, and
   test annotations/routes contaminating production observations. Build a
   deterministic multi-candidate index, never choose the last duplicate. Keep
   unresolved pairings explicit and conservative. Recheck Java/Kotlin/JS cases.
2. `src/runtime/interview-orchestrator.mjs` (reuse its canonical renderer, no
   copied renderer or extra module), and implementation orchestrator/tests:
   remove only generated context sections exactly duplicated in the approved
   generated plan. Check finalized artifact digest, renderer equality, supported
   schema and task identity. Keep approvedPlan byte-for-byte, retain unique
   context/attention notices and all manual/custom task text. Do not alter
   approval records, command-adapter schema, source guards or verification.
3. `scripts/benchmark-provider-comparison.mjs`: version the changed experiment
   protocol; no silent reuse of v33 results. Offline replay measures actual v33
   payload and checks correct FastAPI test pairing. Run targeted suites first.
4. Run a new paid public FastAPI pair with identical Codex model/fast profile,
   attempt limit and prepared baseline. Record input bytes and actual time,
   tokens, failures and acceptance. Do not infer causality from one observation.
   Extend to a Claude pair or another independently controlled public task when
   preflight permits; never run company source or weaken a failed control.
5. Run full regression/coverage, selected mutations, install, syntax, document
   contracts. Record commands, red/green evidence, public fixture provenance,
   unexecuted platform/DB checks and residual risks under `docs/evidence/`.
   Review final diff, commit scoped files and push the existing task branch.

## Safety and compatibility

- No provider authority to declare PASS; original gates and hidden independent
  acceptance remain the verdict source.
- No production network/DB operations, global auth/config edits or broad cleanup.
- Matching is a source-pattern hint, not a proven runtime coverage relationship.
- Context reduction is optional: unknown schema, stale digest, modified text or
   any mismatch falls back to the full original task.
- Test name buckets are bounded to 128 distinct candidates per test. Larger
  buckets remain ambiguous, with an explicit count also preserved by
  `src/core/project-conventions.mjs` and tested in its contract suite. This bounds
  duplicate-name candidate expansion instead of hiding a quadratic scan.
- Add four selected mutation regressions for Python prefixes, ambiguous ties,
  candidate-budget enforcement and full custom-context fallback.

## Experiment extension after initial results

- Codex FastAPI: both pass; BTH is still slower. Preserve this negative result.
- Claude FastAPI: both CLI invocations fail at quota before inference. No model
  verdict and no account/config workaround. This does not block independent work.
- Spring whitespace search: fresh prepared base passes 71 tests; independent
  controls reproduce two regressions on base and pass all six on target. Extend
  the actual Codex paired comparison to this distinct task using the same fixed
  model/fast profile/attempt limit. Record failures without post-hoc candidate edits.

## Observed completion of this increment

- FastAPI: Codex BTH/direct both pass 58 ordinary + 7 independent cases. BTH
  workflow 92,677ms versus 66,722ms: still slower.
- Spring: Codex BTH/direct both pass 72 ordinary + 6 independent cases. Workflow
  97,798ms versus 99,953ms: one near-parity observation, not a general advantage.
- Claude: both invocations stop at quota before inference; no completed review.
- Regression 530 total / 526 pass / 0 fail / 4 skip; 33 selected mutations killed;
  install, syntax, CLI docs and runtime dependency audit completed.
- Disk free space about 4.8GiB. Preserve records; no user files or shared caches
  deleted. Keep the overall goal active, with remaining tasks and platform proof.
- Keep the overall goal active: one successful pair is not 20-task validation.
