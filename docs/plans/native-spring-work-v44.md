# v44 — Native Spring workflow, with original project verification

## Scope and success boundary

Extend the native-workflow evaluation beyond FastAPI. Start with the pinned public
`spring-02-owner-search-whitespace` task, whose independent acceptance fixture already
covers six search/authorization-independent behaviors. This is evidence toward the
three-repository/twenty-task goal, not a replacement for that goal or a release claim.
No company checkout, production database, real provider configuration or retained
previous implementation candidate may be changed. No new model price assumption.

## Source exploration

- `scripts/benchmark-provider-comparison.mjs`: native mode requires an explicit
  immutable project fixture; prepares a history-sanitized clone, checks the base,
  then invokes each lane. Failed setup must stop before inference.
- `src/evaluation/provider-project-preparation.mjs` and `project-fixture*.mjs`:
  fixture files are hash/preimage bound and limited to tests or verification wrappers.
- `src/config/verification.mjs`: ordinary Maven initialization already uses
  `./mvnw -o -B verify`; do not weaken that to selected tests or skip format checks.
- Public Spring base `0f6e8614047bd74cf6223b4d8a858d2ed2824f8a` has Maven,
  Spring JavaFormat/checkstyle, JUnit reports and existing test sources. Preserve them.
- `src/core/platform.mjs`: only verify-portable currently maps to a Windows wrapper;
  public FastAPI and the new Maven fixture also need their exact `.cmd` companions.
- `src/providers/validation-activity.mjs`: strict shell observation remains conservative;
  POSIX execution evidence is not Windows provider validation.

## Atomic edit and verification plan

1. Add failing tests in `test/public-maven-fixture.test.mjs` for pinned fixtures,
   preserved Maven lifecycle/exit status, rejection of additional arguments and exact
   known Windows wrapper mappings. No unknown executable may gain an inferred suffix.
2. Add `benchmarks/public-backend-v1/fixtures/spring/verify-public-maven` and `.cmd`.
   Delegate to the project Maven wrapper with `-o -B verify`, without test selection,
   skip flags, source rewriting, hidden format repair or dependency downloads.
3. Add the hash-bound project fixture to the Spring search task in
   `provider-comparison.json`, including Maven/config/checkstyle inputs and JUnit
   report paths; verify baseline with the actual cached Java/Maven environment.
4. Update `src/core/platform.mjs` for the two exact public verification wrappers;
   run mapping and wrapper subprocess tests. Report actual Windows execution untested.
5. Before paid inference, run preflight on the sanitized base and independent
   acceptance controls. A dependency or baseline failure remains a failure, not a
   reason to bypass the project's verification rules.
6. Add a v44 source-sealed collector under `docs/evidence/artifacts/v44/` before
   native inference. Run Codex fast / explicit model on both lanes sequentially,
   with the same prepared fixture, provider allowance and independent acceptance.
   Keep workspace candidates. No manual code correction in either scored candidate.
7. Collect exact outputs, bounded source snapshots and final-source verification
   matches. Explain remaining unknowns (cost, direct internal repair count, limited
   tool trace, one task and asymmetric managed-vs-provider test time).
8. Run targeted regression, full test/coverage, curated mutation tests, installation
   smoke, secret scan and `git diff --check`. Add the measured v44 evidence report,
   update relevant README/CHANGELOG/progress only with proven facts; commit and push
   to the existing task branch. Do not overwrite historical sealed artifacts.

## Stop conditions

### Inspection amendment before implementation

The original PostgreSQL integration test invokes Docker Compose with fixed host
port 5432; the original MySQL Testcontainers setup publishes on all interfaces.
Do not run those defaults during comparison. Add pinned, preimage-bound test-only
overlays for `MySqlIntegrationTests`, `MysqlTestApplication` and
`PostgresIntegrationTests`, plus a shared `BthDatabaseFixture`. Preserve every
original test method/assertion; replace only database provisioning with owned,
no-pull, loopback, tmpfs containers using cached exact image IDs. The Maven wrapper
must enforce Docker availability and verify owner-labelled cleanup on exit. Add
unit tests for safe cleanup and container policies and a real baseline run. The
project POM, production code, original Compose file and assertions remain untouched.

Low disk is not permission to delete shared caches or old candidates. Use cached
dependencies and one case at a time. No successful native workflow claim until
both the actual project gate and independent task acceptance have passed, with
direct lane's required validation observed. The overall goal remains active.

### Disk-pressure amendment

The prepared Maven suite passed 71/71. Subsequent independent acceptance exhausted
disk because `task-acceptance.mjs:cloneAt` duplicates the complete mirror for each
base/target/candidate with `--no-hardlinks`. The simultaneous QA run is invalidated
by ENOSPC and must be repeated; no success claim from its partial output.
Add a local-only, depth-one Git snapshot helper and tests for exact HEAD/tree,
absent unrelated history/alternates/remotes, dirty source preservation and rejection
of symlinks/submodules. Preserve original SHA so candidate source equality remains
strict. Integrate only the evaluation snapshot path, measure `.git` storage on the
real Spring mirror, and re-run all acceptance regression tests before inference.
