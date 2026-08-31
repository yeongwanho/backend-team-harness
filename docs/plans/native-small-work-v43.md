# v43 — small backend changes through the real native workflow

Previous turn is progress: 3249d9e pushed guarded native completion and real
observations. The original direct native validation was unconfirmed. The full
3-backend/20-task goal remains active, without a completion percentage.

## Current evidence

The current configuration has 20 tasks, 11 independent oracles and only two
prepared native-workflow fixtures (FastAPI auth and missing-user handling).
Historical inference exists on nine distinct tasks, but mixed protocols cannot
establish current-runtime success or performance. Review source-matched evidence
instead of treating configured fixtures as passed tasks.

## Work and verification

- [x] Read current BTH contribution rules, build a code map, trace the native
  runner, command observer, fixture preparation and 20-task configuration.
- [x] Add a v43 source sealer/collector under `docs/evidence/artifacts/v43/`.
  Freeze runtime, corpus, evaluator and collector before inference. Preserve
  terminal outcomes including failure/unknown, protected inputs, final source
  binding, CLI version/profile, usage, observed validation and candidate hashes.
- [x] Run `fastapi-05-missing-user` with native-workflow, explicit fast/low Codex
  gpt-5.6-sol, both lanes, shared 240-second provider allowance and BTH max three
  calls. This tests the requested small-change path, not a claim that low effort
  is universally better. Same pinned source, requirement and public synthetic
  database setup; no company code or production access, no candidate application.
  Retain originals and candidates. Do not manually fix a candidate into success.
- [x] Inspect both candidate diffs and structured evidence. Verify missing-user
  behavior, existing 403 authorization, existing-user success and regression
  tests. Separate model trace uncertainty from evaluator success. If a runtime
  flaw is demonstrated, add a failing regression, fix the actual path, and keep
  pre-fix observations separate; never silently rerun only the favorable lane.
- [x] Rebuild an auditable 20-task status view. Do not count v42's unconfirmed
  direct native validation as completed native work, and do not pool controlled
  edit with whole-request outcomes. Keep unconfigured/unexecuted tasks visible.
- [x] Record a readable report, README/change-log pointers and exact artifacts.
  Run scoped tests for changed code and full QA proportional to any runtime
  changes. Commit/push only verified work, keeping the original full goal active.

## Limits

Only about 1.7 GiB disk was free at start; reuse existing pinned dependency/image
caches and run public cases sequentially. Never delete shared caches or retained
past candidates to make a measurement fit. No actual Windows, MySQL or second
developer adoption claim follows from this FastAPI experiment. Native Claude,
the remaining task oracles and real native runs across other backends remain
required goal work, not silently dropped scope.

## Additional verified opportunity: actual MySQL E2E

The pinned-version MySQL 8.4.11 image is already cached. Before opting into the
existing DB E2E, fix its broad `ancestor=mysql:8.4.11` cleanup that could remove
someone else's concurrent container. Own edits to `test/db-real-e2e.test.mjs`, a
small `test-support/owned-docker-resources.mjs` helper and its regression tests,
and the example Gradle/Java fixture that forwards a per-run UUID container label.
Validate label+full-ID+image before forced cleanup, use a temporary in-memory
database directory, and never remove arbitrary same-image resources. Run failing
ownership tests first. Real MySQL/Flyway positive, assertion failure, process exit
and timeout E2E runs only after timed provider comparisons finish. Record real
outcomes and omissions; no production DB or company repository is involved.

## Observed result

Both real Codex native lanes passed 58 ordinary and seven independent tests;
the direct approved command had one observed failure and one success. Original
records/candidates are preserved, no manual repair or application. One native
paired task is confirmed, not 20 tasks or all providers.

MySQL reference E2E passed all four lifecycle scenarios with zero owned MySQL
containers remaining. The fixture now uses a random password and asserts actual
loopback port binding. Full regression: 614 tests, 610 passed, zero failed,
four default opt-in/platform skips. 48 curated mutations were assertion-killed;
package installation smoke passed. Ready for verified progress commit/push.
