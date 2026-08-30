# Portable DB planning v23

2026-08-31. This checkpoint corrects planning, not database execution. The active
three-backend/twenty-task implementation-and-efficiency goal is not complete.

## What changed for a developer

- An existing TypeORM or Alembic project no longer has to pretend it uses Flyway
  to plan a schema change. Static evidence must connect configuration to revision
  files; a dependency name alone is not enough.
- If no supported mechanism is observed, schema work asks whether this is an
  existing-database upgrade or initialization of new empty databases only.
  `schemaStrategy: "bootstrap-only"` explicitly excludes existing-data upgrades;
  it does not grant approval or waive project rules and tests.
- New no-DB-impact interviews do not acquire an unnecessary DB step merely
  because the repository contains migrations. Old immutable snapshots retain
  their old renderer so finalized records can still be replayed.
- Plans list bounded configuration/revision paths, not configuration values.
  Bootstrap schema work remains deep in auto mode; compatible existing-schema
  CRUD remains eligible for fast mode. Explicit user modes remain explicit.

## Source-based findings and boundaries

The old interview contradiction checked only `database.flyway.present`. The
new additive `database.migration.present` fact accepts bounded source-pattern
observations. Its meaning is **not** “this migration will run safely.”

TypeORM detection currently requires a package dependency, a migration-run script
with a static DataSource argument, a `new DataSource` configuration with supported
literal migration globs, and linked TypeScript `MigrationInterface`/up/down
patterns. Dynamic commands/configuration, aliases, class-list arrays, spread
overrides, unsupported glob shapes, and JS-only revisions are not established by
this detector. It is not a TypeScript parser or runtime configuration evaluator.

Alembic detection currently requires `alembic.ini`, one project-contained static
`script_location`, a linked environment with an Alembic import, and revision IDs
with upgrade/downgrade functions. Nested revision paths require explicit
`recursive_version_locations = true`. Custom `version_locations`, pyproject-only
setup and dynamic/resource locations remain unsupported. Empty/new migration
chains still require a project decision rather than fabricated confirmation.

The new detector reuses the manifest and a sorted prefix lookup for linked files.
Reads are bounded to 128 files, 256 KiB per file, and 4 MiB aggregate, with regular
file, containment, symlink and descriptor checks. Diagnostics are bounded. It
does not import a DataSource, run env.py/package scripts, install dependencies or
open a DB connection. Incomplete scans remain unknown. Evidence contains paths
and content hashes, never the configuration values read for discovery.

Flyway discovery remains the existing doctor convention check. Default automatic
released-migration immutability enforcement is still **Flyway-specific**; the
append-only instruction is not equivalent to an enforced TypeORM/Alembic gate.
Projects need their own verification for those upgrade/rollback contracts.

Primary references used for semantics, with pinned task source taking precedence:
[TypeORM migration execution](https://typeorm.io/docs/migrations/executing/),
[Alembic configuration and revision discovery](https://alembic.sqlalchemy.org/en/latest/tutorial.html),
[Spring Boot database initialization](https://docs.spring.io/spring-boot/how-to/data-initialization.html).

## Real twenty-task plan-only probe

Command (existing public mirrors; no fetching, model, dependency setup or DB):

```sh
node scripts/benchmark-retrieval-query.mjs \
  --cache /tmp/bth-provider-comparison-cache-v2 \
  --output /tmp/bth-db-plans-v23-reviewed.json
```

Result: **20/20 plans proposed**, no hidden failures, 46,687 ms total probe time.
This includes cloning, planning and two advisory rankings per task; it is not
ordinary CRUD latency or provider implementation time.

| Previously blocked task | Source evidence / explicit decision |
|---|---|
| spring-03-unique-pet-name | Existing bootstrap SQL; explicit bootstrap-only decision |
| spring-07-mysql-user | Existing MySQL bootstrap script; explicit bootstrap-only decision |
| nest-07-refresh-token-single-use | TypeORM 0.3.19 package command, DataSource, linked revision |
| fastapi-03-created-at | Alembic ini, env.py, four linked revisions |

Only the two Spring benchmark decisions changed. The target code, gold paths and
task requirements were not changed to make this probe pass. Nest's historical
target rewrites/renames an initial migration: it is not evidence of a safe upgrade
for a deployed database and still needs an independent behavioral oracle.

At the same 2,000-character context cap across all twenty tasks, the selected
requirement query gives mean Recall@5 **0.368214**, Recall@20 **0.436548**, and
nDCG@20 **0.376748**. The legacy operational-text query on this same set gives
**0.264881 / 0.344048 / 0.289777**. Four selected tasks still have zero Recall@20:
FastAPI missing-user/delete-self and Nest Swagger/email-conflict. The earlier
v22 result covered sixteen tasks, so its aggregate is not a valid before/after
denominator for this twenty-task checkpoint. No token/time savings are inferred.

Persistent [machine-readable evidence](artifacts/v23/database-planning.json):
SHA-256 `3371b27354056afed8f610d109220f911e430ac5296e20b45fca60b3f9724877`.
It binds all twenty pins/requirements, corpus/config hashes, changed planning
module hashes, decisions, discovery observations and rankings. `sourceCommit`
is the pre-change parent 3567b0b; per-file hashes bind the uncommitted probe source
and were compared with the final planning files. No company source or raw model
transcript is included.

## QA

Failing-first controls reproduced the Flyway-only/schema-strategy error, the
unnecessary no-impact DB step, Alembic's incorrect recursive discovery, and
bootstrap being eligible for auto fast. Focused suites then passed. A separate
legacy test initially compared a first-finalization-only return field; correcting
it to the persisted record digests confirmed idempotent replay without weakening
runtime digest checks.

Final commands: `npm run test:coverage`, `npm run test:mutation`,
`npm run test:install`, `node scripts/check-syntax.mjs`, and `git diff --check`.
Final full suite on macOS arm64 / Node v22.23.1: **403 tests, 399 passed, 0 failed,
4 skipped**. Coverage: **90.21% lines, 79.40% branches, 98.77% functions**.
All eight targeted mutants were killed after passing unmutated baselines;
the two new controls each ran seven passing tests before producing one assertion
failure. The installed 0.9.0 package smoke and syntax/diff checks passed.
The two new migration mutants remove nested-property association and
directory-scope guards; each must first pass its unmutated test suite, then fail
with an executed assertion. Mutation smoke is not full-repository mutation coverage.

No paid provider or actual database ran for this checkpoint. Four default-suite
environment skips remain real JVM/MySQL opt-in and two actual-Windows cases.
No Windows, company DB, or OS-level network isolation guarantee is added.

## Work still required

Independent task-specific regression controls remain **3/20**, with successful
paid Codex pairs on only **two distinct tasks**. The seventeen other controls,
safe Node/Python service setup, migration runtime checks, full paired runs,
retrieval misses and comparable token/time measurements remain unfinished.
Twenty proposed plans must not be reported as twenty implemented tasks.
