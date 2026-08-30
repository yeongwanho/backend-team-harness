# Retrieval and fast implementation comparison v22

The full product goal is unchanged. Keep the evaluated source at commit 35d827d
fixed while the Codex BTH/direct pair runs. Do not run heavy local QA concurrently
with its timing measurements. Record a failed implementation as a failed attempt,
not as a missing observation or an oracle success.

1. Run `spring-01-pet-association` through both lanes with explicit
   `gpt-5.6-sol`, `fast`, one attempt and the same normal/independent verification.
   Record task success, rule violations, total and uncached tokens, time and any
   unavailable cost. Do not compare this different model/mode/task as if it were
   a repeat of the earlier default-model/balanced whitespace pair.
2. The corrected corpus places the Nest Swagger entrypoint at rank 39. Inspect
   `packs/codegraph-advisory/indexer.mjs` `parseEcmaSource` and
   `src/core/code-context.mjs` `lexicalTerms`/`personalization`. Current portable
   graph terms include declarations/imports but not called members; snake_case
   identifiers are not split like camelCase. The original source uses global
   interceptor and document-builder calls. These are hypotheses for improving
   retrieval, not proven explanations of every bad rank.
   The real Spring fast run also supplied poorer candidates (Recall@5 0) than
   direct requirement-only static ranking (Recall@5 0.75). Inspect `planQuery`
   in `src/runtime/implementation-orchestrator.mjs` and
   `src/runtime/plan-export.mjs`: they append the full operational plan or every
   plan string to the retrieval query. Test query pollution on the same graph and
   same 2000-character budget before attributing the difference to this cause.
   If confirmed, separate the user requirement used for retrieval from the full
   approved instructions that must still be delivered intact to the provider.
3. Before changing retrieval, add synthetic tests independent of public task
   names to `test/code-context.test.mjs` and the applicable graph-index tests.
   Cover underscore identifiers, relevant method usage, unrelated imported
   libraries, missing/ambiguous evidence and unchanged privacy/budget caps.
   Do not hardcode repository names, gold paths, or require wider source payloads.
4. After the paid pair finishes, consider bounded identifier extraction and
   allocation-reducing scoring only if the tests and unchanged-corpus measurement
   support them. Inspect graph cache/generation contracts before reuse; the live
   `src/adapters/bounded-code-context.mjs` path currently builds a fresh graph.
   Preserve advisory-only authority, source binding and required test gates.
5. Compare all 20 tasks with the exact v21 corpus hash, record per-task regressions
   as well as the mean, and measure representative cold/warm CPU and memory cost.
   A rank improvement does not prove lower provider tokens or task success.
6. Continue the 17 missing task oracles and owned service setup from the v21 audit.
   Full 3-repository/20-task paired execution remains mandatory for completion.

## First bounded patch: retrieval text, not the ranking algorithm

- Add `scripts/benchmark-retrieval-query.mjs`: use existing public mirrors only,
  fresh owned clones, `init` and plan-only `runWork`; no dependency install,
  provider call or test gate. Compare legacy title/context/full-plan query with
  requirement-only input on each identical graph at 2,000 characters. Bind output
  to corpus, config, pins, query hashes and graph generation. Preserve failures.
- Add `src/core/retrieval-query.mjs` only if the controlled probe supports it:
  prefer bounded non-empty task context, otherwise title, then manual plan;
  never traverse arbitrary plan objects or coerce untrusted objects to strings.
  Retrieval relevance is advisory, not authority to omit approved instructions.
- Add `test/retrieval-query.test.mjs` with failing-first semantic-query selection,
  manual fallback, bounded/invalid inputs and graph ranking contamination cases.
- Replace the two `planQuery` implementations in
  `src/runtime/implementation-orchestrator.mjs` and `src/runtime/plan-export.mjs`
  with the same selector. Keep provider payload, approval receipts, exported
  full plan, source checks and context budgets unchanged.
- Extend `test/implementation-orchestrator.test.mjs` and
  `test/harness-v1-cli.test.mjs` to prove real request/export uses selected
  semantic query while preserving full operational plan and permission limits.
- Re-run the controlled 20-task probe, compare each task including regressions;
  run focused tests, full coverage, mutation smoke, installed-package smoke,
  syntax and diff checks. Write evidence and push. No claim of lower paid tokens
  without another actual paired trial; no algorithm/cache changes in this patch.

The first rerun disproved that `task.context` is always the original requirement:
`syncFinalizedPlanToTask` replaces it with acceptance/scope/data/fact summaries.
Therefore retrieve the original requirement from the already validated interview
record in `structuredImplementationContext` / `exportApprovedPlan`, with the
bounded task-text fallback only for manual tasks. Add an actual finalized-
interview export/request regression, not only manual-task tests. The probe must
compare the actual selector using that record, not a theoretical query alone.
Extend `scripts/mutation-smoke.mjs` with removal of that canonical-requirement
preference; require its unmutated baseline pass before counting the assertion
failure. Bind the probe's runtime and script files by hash as well as Git HEAD.
