# Database planning portability v23

Goal remains three independent backends/twenty real tasks with paired provider
evidence. Previous turn was progress (3567b0b); no completion claim is justified.

## Evidence and scope

`deriveInterviewContradictions` equates migration support with
`database.flyway.present`. Actual pinned Nest has TypeORM 0.3.19, package migration
commands, `src/database/data-source.ts` and versioned migrations. Actual FastAPI
has `backend/alembic.ini`, a linked script directory, `env.py` and revisions.
Spring's two blocked tasks change bootstrap SQL, not an existing migration chain.
`deriveWorkDraft` currently turns every schema change into requiresMigration=true.

Use static, bounded observations only. Never import configuration, evaluate
package scripts/env.py, install dependencies or connect to any DB. Observing a
mechanism removes a false planning contradiction; it does not prove that the
tool runs or that a migration is safe. Missing, partial and ambiguous observations
remain explicit. Bootstrap-only approval cannot waive project blocker rules or
claim compatibility for an already populated database.

## Atomic edit / verification units

1. Add `src/core/migration-discovery.mjs` and
   `test/migration-discovery.test.mjs`: reuse the source manifest, inspect bounded
   regular project-contained files, emit paths/hashes (never config values).
   Observe Flyway conventions, TypeORM dependency + declared migration command /
   data-source configuration + associated revisions, and Alembic config + linked
   env/revisions. Reject traversal, symlinks, missing associations, empty/dynamic
   configuration, oversized inputs and false positives from dependencies alone.
2. Wire the report through `src/adapters/project-context.mjs` and
   `src/adapters/project-intelligence.mjs` as additive generic migration facts;
   keep existing Flyway fact/rule contracts. Test source-bound output and no
   secret values in `test/project-intelligence.test.mjs`.
3. Update `src/core/interview-state.mjs` migration contradiction/hints to accept
   known non-Flyway evidence, with legacy Flyway fallback only for older snapshots.
   Update `src/runtime/interview-orchestrator.mjs` DB step wording: distinguish
   declared bootstrap-only from upgrade verification, preserve gates/approval.
   Test confirmed/unknown/missing and source-rebind invalidation in the existing
   interview suites. Do not automatically resolve unrelated contradictions.
4. Extend `src/core/work-draft.mjs` and `src/runtime/work-orchestrator.mjs` with
   optional schemaStrategy=`migration|bootstrap-only`. Ask for strategy when a
   schema change has no observed mechanism; infer migration only from confirmed
   evidence. An explicit migration without a mechanism still needs configuration
   or explicit contradiction resolution. Reject a schema strategy on non-schema
   work. Add draft + real `bth work` tests for necessary questions, full approved
   scope text, unchanged write/verification rules, and bootstrap not permitting
   edits to protected/released migrations.
5. Extend `src/evaluation/provider-benchmark-config.mjs` validation and tests for
   that decision. In `benchmarks/public-backend-v1/provider-comparison.json`, set
   bootstrap-only for the two source-verified Spring bootstrap tasks, not for
   arbitrary schema changes. Keep the full 20 tasks, pins and oracles unchanged.
   New config hash separates later measurements from earlier paid pairs.
6. Re-run the real 20-task plan-only probe, retain any refusal, then extend actual
   regression controls where safe. Do not convert plans or static detection to
   implementation/DB success. Full coverage, mutation, installation, syntax/diff
  checks, source-bound evidence and a pushed checkpoint are required.

Additional verified scope: for new snapshots, an explicit no-DB-impact answer
must not insert a DB stage just because migration files exist. Keep legacy
snapshot rendering/candidate hashes compatible so old finalized artifacts are
not silently rewritten. Emit bounded observed mechanism paths in new migration
plans, and bind the real probe's new planning/discovery modules by content hash.

Review follow-up: test Alembic nested revision paths against its explicit
`recursive_version_locations` setting (default false). Add two assertion-bound
mutation controls in `scripts/mutation-smoke.mjs` for configuration association
and directory scope. Correct the compatibility test to compare the persisted
record digests, not a first-finalization-only return convenience field. Record
the final probe under `docs/evidence/artifacts/v23/`, explain unsupported static
patterns and remaining runtime gaps in `docs/evidence/database-planning-v23.md`,
and link a short user-facing summary from `README.md`.

Risk-routing follow-up: `src/providers/model-cli.mjs` currently interprets
requiresMigration=false as possible CRUD even when the new bootstrapOnly claim
means schema creation. Keep auto bootstrap schema work in deep mode, with a
specific reason, while compatible existing-schema CRUD remains eligible for fast.
Cover both in `test/model-cli-provider.test.mjs`; explicit user modes stay explicit.

References checked: TypeORM migration execution/data-source documentation;
Alembic tutorial (script_location/env/revisions); Spring Boot database
initialization guide. Actual pinned source takes precedence over latest docs
when describing these historical task bases.
