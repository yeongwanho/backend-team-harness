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
4. Raw and converted outputs cannot follow a symbolic link to overwrite an external file.

## DB — `db-integration`

This Pack deliberately installs a failing recipe until the project defines its lifecycle.

The generated Gate declares `network: true` because dependency resolution and Testcontainers/Compose image pulls may need network access. Run it with `--acknowledge-network-risk` only after reviewing the project-owned lifecycle. The flag records acknowledged risk; it does not enforce an OS network boundary.

Gradle expects an `integrationTest` task. Maven expects a `db-integration` profile executed by Failsafe and honors the generated dedicated report directory. Adapt the generated Gate rather than building another lifecycle inside BTH.

The maintained reference implementation currently targets MySQL 8.4 LTS with a pinned `mysql:8.4.11` Testcontainers image. Its real-container test exercises Flyway migration, MySQL-specific column behavior, JDBC reads/writes, and teardown across successful, failed, abruptly terminated, and timed-out test processes. The Core remains database-neutral; a project running another database must replace the project-owned lifecycle and declare its real dialect.

Required project proof:

1. Same production dialect and relevant major version; for the reference path, MySQL 8.4.
2. Empty-schema migration from the first migration.
3. Important upgrade path when old data/schema compatibility matters.
4. Application integration tests, not only DDL parsing.
5. Teardown on success, assertion failure, process failure, and timeout.
6. Synthetic credentials and no production access.

Atlas or another migration linter can be added as a required `findings` Gate. It supplements these tests; it does not replace them.

## Architecture — `architecture`

Add a project-owned `architectureTest` Gradle task, or Maven `*ArchitectureTest` tests, using ArchUnit, Spring Modulith, or ordinary executable checks. The installed Pack includes copyable Kotlin-DSL and Groovy-DSL Gradle task snippets; adapt the class filter to the project's naming. The snippets exclude `*ArchitectureTest` from the default `test` task so the rule is not executed twice. Every executable Pack owns a unique JUnit directory. BTH rejects exact collisions and conservatively rejects wildcard patterns rooted in the same or nested report tree because freshness ownership would be ambiguous. Prefer a few stable rules with explicit exceptions over a huge generated diagram.

Useful rules include module direction, forbidden adapter/domain access, transaction boundaries, and public API boundaries.

## 0.7 to 0.8 report migration

Older installed architecture, contract, or DB Gates may share `build/test-results/test/` or `target/failsafe-reports/` with another Gate. 0.8 refuses to start until every Gate owns a separate report directory. Move Gradle reports to `build/test-results/<gate>/` and Maven reports to `target/bth-reports/<gate>/`, using the current Pack command arguments as examples. Report patterns must include a dedicated directory; project-root patterns such as `**/*.xml` are invalid. Existing report files must also be Git-ignored and untracked before BTH will remove them for a fresh run.

## Contracts — `contract`

Connect Pact, Spring Cloud Contract, OpenAPI compatibility, protobuf/schema compatibility, or message fixtures to a dedicated JUnit task/profile. Include errors and compatibility, not only happy-path serialization.

## Graph — `codegraph-advisory`

The bundled graph is intentionally conservative. It indexes Java/Kotlin, TypeScript/JavaScript, and Python source files. It resolves JVM types and unique static project-module imports; ambiguous aliases remain unresolved. SQL, configuration, template, and Markdown files are represented by path-only artifact nodes so migration and configuration changes can be localized without copying their bodies into graph evidence. In particular, `.env` contents are never read.

Each edge records `static-import-resolved`. Wildcards and external imports count as unresolved coverage gaps. Duplicate qualified type declarations make a matching import ambiguous, so the Pack reports the ambiguity and creates no edge. The output carries a deterministic `generation` hash and a non-deterministic `generatedAt` timestamp. It is compact JSON with the same 16 MiB maximum accepted by the loader; generation fails instead of producing a report the next stage must reject. Its atomic writer replaces a final-file symbolic link without following it and rejects an output directory that resolves outside the project.

The graph also records uniquely resolved JVM test-name pairs and adjacent TypeScript/JavaScript/Python test-path pairs as convention evidence. The generated graph includes a deterministic global directed PageRank for broad navigation. When an approved task is exported, BTH can compute a separate query-aware ranking with a hard character budget:

1. verify that the graph digest and byte count match a successful observation in the latest sealed run;
2. require that run and the current project have the same source fingerprint;
3. seed nodes whose path, qualified declaration, or bounded declaration/import terms match normalized requirement terms;
4. propagate only over exact stored imports, with reverse traversal at half weight;
5. blend lexical prior and graph score, record residual/tolerance and whether the bounded iteration converged, then include only complete entries that fit the requested budget;
6. when a selected production/test node has a uniquely resolved test-pair neighbor, co-select the highest-ranked pair before unrelated nodes if it still fits the same budget.

No match falls back to global graph importance rather than inventing semantic relevance. Authority lists are bounded to 16 short identifiers each, so they cannot inflate a tiny entry budget into an unbounded payload. A missing, stale, tampered, oversized, symlinked, or contract-invalid graph produces an explained `unavailable` result and never blocks plan export.

The provider implementation path prefers this sealed graph. If it is absent, `bth work --run` may build the same bounded graph in memory, verify that the source fingerprint did not move during inspection, and discard it after creating the sealed provider request. When one nested portable backend was uniquely identified from its test build, this fallback indexes only that project-relative backend path. It remains advisory and cannot create PASS or remove tests.

Allowed uses:

- navigation
- review questions
- locating modules that deserve tests

Forbidden uses:

- PASS decisions
- test skipping
- guessed method-call or runtime wiring claims

If a richer engine is connected later, preserve per-edge provenance such as compiler-resolved, bytecode-resolved, runtime-observed, LSP-resolved, static-inferred, heuristic, or unknown. Do not compress those categories into one misleading confidence number.
