# Pack guide

## Boundary

A Pack installs project-owned commands, tests, or advisory collectors. It does not add company policy to Core. Installation is explicit, refuses collisions, and backs up `verification.json` before adding a Gate.

```bash
bth pack list
bth pack install <id> /path/to/project
```

## Secrets — `secrets-gitleaks`

Prerequisite: the open-source Gitleaks CLI on `PATH`.

The wrapper runs a redacted directory scan, deletes Gitleaks' intermediate JSON, discards `Secret`, `Match`, and source-line bodies, and emits the BTH Findings contract. It uses the CLI project, not the separately licensed Gitleaks GitHub Action.

Acceptance:

1. A synthetic credential produces a `high` finding and blocks verification.
2. The BTH report contains no secret body.
3. A missing Gitleaks binary fails closed.

## DB — `db-integration`

This Pack deliberately installs a failing recipe until the project defines its lifecycle.

The generated Gate declares `network: true` because dependency resolution and Testcontainers/Compose image pulls may need network access. Run it with `--allow-network` only after reviewing the project-owned lifecycle. The flag records approval; it does not enforce an OS network boundary.

Gradle expects an `integrationTest` task. Maven expects a `db-integration` profile executed by Failsafe. Adapt the generated Gate rather than building another lifecycle inside BTH.

The maintained reference implementation currently targets MySQL 8.4 LTS with a pinned `mysql:8.4.11` Testcontainers image. It proves Flyway migration, MySQL-specific column behavior, JDBC reads/writes, and teardown across successful, failed, abruptly terminated, and timed-out test processes. The Core remains database-neutral; a project running another database must replace the project-owned lifecycle and declare its real dialect.

Required project proof:

1. Same production dialect and relevant major version; for the reference path, MySQL 8.4.
2. Empty-schema migration from the first migration.
3. Important upgrade path when old data/schema compatibility matters.
4. Application integration tests, not only DDL parsing.
5. Teardown on success, assertion failure, process failure, and timeout.
6. Synthetic credentials and no production access.

Atlas or another migration linter can be added as a required `findings` Gate. It supplements these tests; it does not replace them.

## Architecture — `architecture`

Add a project-owned `*ArchitectureTest` using ArchUnit, Spring Modulith, or ordinary executable checks. Prefer a few stable rules with explicit exceptions over a huge generated diagram.

Useful rules include module direction, forbidden adapter/domain access, transaction boundaries, and public API boundaries.

## Contracts — `contract`

Connect Pact, Spring Cloud Contract, OpenAPI compatibility, protobuf/schema compatibility, or message fixtures to a dedicated JUnit task/profile. Include errors and compatibility, not only happy-path serialization.

## Graph — `codegraph-advisory`

The bundled graph is intentionally conservative. It indexes Java/Kotlin files/types and resolves only explicit imports to indexed project types.

Each edge records `static-import-resolved`. Wildcards and external imports count as unresolved coverage gaps. Duplicate qualified type declarations make a matching import ambiguous, so the Pack reports the ambiguity and creates no edge. The output carries a deterministic `generation` hash and a non-deterministic `generatedAt` timestamp.

The generated graph also includes a deterministic global directed PageRank for broad navigation. When an approved task is exported, BTH can compute a separate query-aware ranking with a hard character budget:

1. verify that the graph digest and byte count match a successful observation in the latest sealed run;
2. require that run and the current project have the same source fingerprint;
3. seed nodes whose path or qualified type name matches bounded requirement terms;
4. propagate only over exact stored imports, with reverse traversal at half weight;
5. blend lexical prior and graph score, then include only complete entries that fit the requested budget.

No match falls back to global graph importance rather than inventing semantic relevance. A missing, stale, tampered, oversized, symlinked, or contract-invalid graph produces an explained `unavailable` result and never blocks plan export.

Allowed uses:

- navigation
- review questions
- locating modules that deserve tests

Forbidden uses:

- PASS decisions
- test skipping
- guessed method-call or runtime wiring claims

If a richer engine is connected later, preserve per-edge provenance such as compiler-resolved, bytecode-resolved, runtime-observed, LSP-resolved, static-inferred, heuristic, or unknown. Do not compress those categories into one misleading confidence number.
