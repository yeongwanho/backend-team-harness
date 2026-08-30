# Retrieval query correction v22

2026-08-31. This patch changes the text used to find nearby code. It does not
change the ranking algorithm, grant write/verdict authority, skip verification,
or establish a reduction in paid-model tokens/time.

## Reproduced problem

The real fast Spring association pair supplied unrelated controller and
deployment files before the relevant validator/owner. Its old query combined
title, context and the full approved plan (6,680 characters). On the same graph
and 2,000-character context budget, the probe reproduced **exactly the same seven
paths** as the paid BTH request. Original requirement text alone was 199
characters and retrieved three of four historical changed paths, versus one.
The fourth path is a newly added test absent from the base graph.

Two manual-task regressions failed first: live implementation requests and
source-bound plan exports put `AuditClockLockJournalGate` ahead of the requested
service/controller merely because the operational plan mentioned those words.

The first correction (using task context alone) passed those tests but failed the
real corpus rerun: finalized interviews replace `task.context` with a summary of
acceptance, scope, database, constraints and project facts. That 1,211-character
summary still produced the old association ranking. A third regression through
an actual finalized interview reproduced this failure before the final fix.

## Correction and preserved boundaries

`selectTaskRetrievalQuery` now prefers the original requirement from the validated
interview record. Manual tasks without an interview fall back to context, then
a meaningful title (not an auto-generated task id), then a string plan. Each
source is bounded to 64 Ki characters before processing; non-string values are
not recursively traversed or coerced. Both persisted/live implementation context
and approved-plan export use the same selector.

The provider still receives the **complete** approved task context and plan;
the exported plan and approval receipt remain intact. Tests compare those exact
strings, required-gate strategy, advisory-only authority, source provenance and
budget. A synthetic corpus-independent graph demonstrates the distraction.
Canonical-interview preference is additionally mutation-tested against a passing
unmutated baseline. No public task names or gold paths enter the selector.

## Same-graph, same-budget control

```sh
node scripts/benchmark-retrieval-query.mjs \
  --cache /tmp/bth-provider-comparison-cache-v2 \
  --output /tmp/bth-query-control-v22-hashed.json
```

Use a fresh output path and the pre-existing public mirrors from provider
benchmark preparation. The script checks mirror origins and pinned diff/parent
gold, creates owned temporary clones, initializes only those clones, and requests
plans only. It does not install dependencies, call a model or execute a project
test gate. Git lazy fetching and interactive prompts are disabled. Temporary
clones are removed afterwards; mirrors and source projects are not edited.

**16 of 20 tasks materialized plans.** Four correctly stopped at an unresolved
`migration-required-without-configured-mechanism` contradiction: Spring unique
pet name, Spring MySQL user, Nest single-use refresh and FastAPI created-at.
The script retains each refusal and exits 1 instead of presenting a full pass.
They are not silently counted as successful plans or assigned invented ranks.
This exposes remaining migration-setup work, not completion of that workflow.

The following means use only the same sixteen evaluable tasks. This is a
2,000-character context selection experiment, **not** the earlier all-20,
100,000-character static localization benchmark.

| Metric | Legacy operational query | Original requirement |
|---|---:|---:|
| Mean filename Recall@5 | 0.275149 | 0.337649 |
| Mean filename Recall@20 | 0.374107 | 0.412649 |
| Mean filename nDCG@20 | 0.288093 | 0.344699 |
| Association task Recall@20 | 0.25 | 0.75 |

nDCG improved in 7 tasks, regressed in 4, and was unchanged in 5. All actual
selector outputs matched the requirement-only control, and legacy rankings were
stable across reruns. Per-task regressions are deliberately retained:

| Task | Recall@5 old → new | Recall@20 old → new | nDCG@20 old → new |
|---|---|---|---|
| Spring owner whitespace | 1 → 1 | 1 → 1 | 0.693426 → 0.570642 |
| Nest relational file mapper | 0.5 → 0 | 0.5 → 0.5 | 0.237198 → 0.204382 |
| FastAPI CORS | 0.5 → 0.5 | 0.75 → 0.5 | 0.703086 → 0.585570 |
| FastAPI login timing | 0 → 0 | 0.333333 → 0.333333 | 0.167160 → 0.156426 |

Swagger, conflicting user email, missing user and delete-self still have zero
Recall@20 at this small budget. Generic execution words occasionally matched real
gold files by coincidence; removing them is not a guarantee of better rank for
every task. Clarifications found only in interview answers/plan text are still
delivered to the model but are not separately selected as retrieval terms. That
tradeoff and the regressed tasks need further semantic/indexing evaluation.

Durable [per-task controls and source hashes](artifacts/v22/retrieval-query-control.json),
SHA-256 `7a7dc5a30ab31c977d8835549be8bb4834772e759bdbf4ae05448da60ae4583a`.
Git HEAD in this artifact is the pre-patch parent; `sourceHashes` pins the exact
edited selector, consumers and probe that were actually measured. Graph/corpus/
config/query hashes and every selected path are included. Concurrent QA makes
probe duration unsuitable for a performance comparison; only rankings were used.

## Verification

- Failing-first manual request/export: 2 assertion failures, then both pass.
- Failing-first finalized-interview request/export: assertion failure, then pass.
- Focused context/request/export suite before the final interview correction:
  64/64 pass; this was explicitly insufficient, prompting the additional real
  path regression above. Final focused affected surfaces: 3/3 pass.
- Final full coverage: **388 tests, 384 pass, 0 fail, 4 environment-gated skips**.
  Lines 90.02%, branches 78.91%, functions 98.60%; selector 100% in all categories.
- Six targeted mutants killed, each after an executed passing baseline. New
  requirement-preference mutant: baseline 5 pass, mutant 1 assertion failure.
  This is targeted smoke, not repository-wide mutation coverage.
- Installed package 0.9.0 smoke, syntax checks and `git diff --check`: pass.

Logs from this run: `/tmp/bth-query-v22-{red,interview-red,interview-green,coverage,mutation,install}.log`.
Coverage log SHA-256: `a0381703bf46dbe05073cf4f2a5de5723d0bc6e71860998f75a6d91c951ca6cc`;
mutation log: `5b4030d256862e7c24646b119b0dd64a6d94149f59e3f85b34ab8c0bccd578ae`.
No new paid model call ran after this patch. Earlier fast-pair usage therefore
must not be presented as the optimized version's usage. Real Windows, real DB,
all 20 task oracles and the full Codex/Claude paired matrix remain incomplete.
