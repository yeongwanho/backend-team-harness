# Acceptance expansion v21

The product goal remains 3 independent backend repositories and 20 representative
tasks, compared with direct Codex and Claude. One successful task is not completion.

## Edit / verification units

1. Audit all pinned target diffs against `benchmarks/public-backend-v1/corpus.json`
   and `provider-comparison.json`. Correct contradictory or underspecified task
   text and permit required non-secret template paths. Keep `.env` prohibited in
   implementation; record tasks whose reference changes include secrets-sensitive
   paths instead of quietly granting secret access. Verify all gold paths and refs.
2. Add target-owned named regression tests for Spring pet association and future
   visits in `provider-comparison.json`. Exercise real Maven in disposable clones:
   base must execute and fail the intended assertions, target must pass, source
   must remain stable. Do not classify compilation, environment or missing reports
   as a regression. Record exactly which requirements each test does not cover.
   The upstream visit test only checks today's rejection. Add an evaluator-owned
   Java test for past/today rejection, tomorrow acceptance, default date, rendered
   input minimum, and localized messages. Extend acceptance config/evaluator with
   hash-pinned fixture files under the config directory; reject non-test output,
   traversal, symlinks, oversized files and wrong hashes before running commands.
   Test those boundaries first and wire fixtureRoot through preflight/execute.
3. Inspect Nest and FastAPI test/bootstrap configuration and source behavior.
   Classify tasks by unit-test-safe versus ephemeral-DB-required validation.
   Never start those applications against an existing database or mail endpoint.
   Record missing acceptance coverage in reviewer-readable evidence.
4. Add configuration/invariant tests for concrete issues found in units 1–3.
   For any runtime evaluator change add failing-first cases for failure and
   permission boundaries. Run focused tests, full coverage, mutation, syntax,
   installed-package smoke, and diff checks. Preserve missing data as unknown.
   Real MockMvc failures emit rendered HTML into JUnit CDATA. Inspect the parser
   failure and, if confirmed, distinguish inert log text from active XML DTD/ENTITY
   declarations in `src/core/junit.mjs`. First reproduce with a tiny synthetic
   report; retain XXE/DTD rejection and malformed-XML tests, then rerun real controls.
   Mutation-smoke inspection found missing `test-support` in its isolated copy
   and acceptance of any nonzero exit as a killed mutant. Require an unmutated
   passing baseline before each mutation, copy runtime/test dependencies, and
   accept only executed assertion failures with matching test counts. Add parser
   mutants for over-rejection of inert CDATA and under-rejection of active DTDs.
5. Write `docs/evidence/acceptance-expansion-v21.md` with actual commands,
   structured result paths/hashes, observations, omissions and residual risk.
   Commit and push this checkpoint only after QA. Retain the active full goal.

Paid provider comparisons require valid task acceptance controls. No claim of
improved speed, lower tokens, or full task success follows from test plumbing alone.
