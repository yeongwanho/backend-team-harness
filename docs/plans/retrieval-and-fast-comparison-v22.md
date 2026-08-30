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
