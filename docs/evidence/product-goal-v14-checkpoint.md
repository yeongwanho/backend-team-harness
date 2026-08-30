# Product goal v1.4 checkpoint evidence

Date: 2026-08-31

This checkpoint records what the repository proves locally. It intentionally
does not mark the product goal complete: the independent three-repository,
twenty-task comparison and authenticated Windows provider pilots have not run.

## Goal under test

Given a backend requirement, `bth work` should discover source-bound project
conventions, ask only unresolved blocking questions, produce one short plan,
implement in isolation, run changed-path feedback followed by every required
verification Gate, and leave a guarded candidate that can be explicitly
applied without automatically committing, pushing, deploying, or accessing a
production database.

## Implemented surface

- `bth work` is the canonical small-task path over the existing task and
  implementation records.
- Convention evidence covers naming, layers, DTO/error usage, transactions,
  persistence, routes, tables, and tests with source citations.
- MySQL/Flyway and JPA analysis records bounded static observations for indexes,
  query shape, transactions, locks, pagination fetch joins, and N+1 risk. It
  does not claim to be runtime `EXPLAIN` or database-metadata proof.
- Changed-path feedback may fail fast, but a passing feedback loop never
  replaces the configured full verification boundary.
- `bth implement apply` rechecks source and candidate hashes, applies through a
  backup staging area, verifies, and rolls back a partial failure. It never
  commits or pushes.
- CLI errors have stable codes at the process boundary; provider usage has one
  duration/token/cache/cost schema; evidence redaction covers common provider
  credentials, auth/cookie material, emails, URL credentials, and raw
  source-bearing fields.
- CLI routing was split into bounded command modules. The implementation
  orchestrator is smaller internally but remains a large module and is not
  presented as fully decomposed.

## Local verification observed

Commands were run from the task worktree on macOS:

```text
npm run check
324 tests: 320 pass, 0 fail, 4 skip
focused mutation smoke: 3/3 mutants killed

npm run test:coverage
lines 88.95%, branches 78.27%, functions 98.32%

npm run test:install
installed package smoke passed for backend-team-harness@0.9.0

git diff --check
passed
```

The canonical coverage command uses `c8` so the same thresholds run on the
supported Node 20 baseline and newer Node versions. The first CI attempt
exposed that Node's newer built-in threshold flags were unavailable on Node
20; the gate was made version-portable instead of lowering its thresholds.

The four skipped tests are environment-bound checks, including the two tests
that require an actual Windows process model. A macOS skip is not Windows
evidence.

The focused mutation smoke mutates three high-value predicates (task
transition, verification success, and work-draft completion). It is not a
claim of exhaustive mutation coverage.

## Cross-platform CI observed

GitHub Actions run
[`33324335444`](https://github.com/yeongwanho/backend-team-harness/actions/runs/33324335444)
completed successfully for implementation commit `e2c541f`:

- Ubuntu Node 20 syntax, coverage, mutation, and installed-package Gates passed.
- A real Windows runner passed the command-shim provider fixture, descendant
  process-tree timeout cleanup, Windows contracts, cache, inspect, and check
  flows.
- The real JVM fixture passed.
- The Docker-backed real MySQL E2E passed.

The Windows provider fixture proves process and output contracts on Windows;
it does not claim that an authenticated Codex or Claude installation was used.

## Evidence still required before completion

1. Run one opt-in authenticated pilot for each of Codex and Claude on a
   developer Windows machine.
2. Measure the same versioned twenty-task corpus across three independently
   maintained repositories, including one monorepo service and one non-JVM
   backend.
3. Compare BTH and direct Codex/Claude on success@1, repair rate, convention
   violations, escaped-scope edits, Recall@5/20, nDCG, wall-clock splits,
   provider tokens/cost, and retry rate.
4. Have a second developer initialize the harness, receive a handed-off task,
   and finish one task without repository-specific coaching.
5. Add runtime MySQL query-plan and metadata evidence only if the real corpus
   shows the bounded static checks are insufficient.

Until those observations exist, this is a verified implementation checkpoint,
not a production-complete or “better than another harness” claim.
