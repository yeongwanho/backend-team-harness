# Roadmap

A checkbox counts only when a real CLI path and an acceptance test exist. External adoption and cross-machine claims remain unchecked until measured; synthetic fixtures are not renamed as production proof.

## 0.4 — Trustworthy evidence and Pack boundary

- [x] strict XML parser with DTD/ENTITY rejection
- [x] per-file report freshness with mixed fresh/stale fail-closed behavior
- [x] executed-test count excludes skipped cases
- [x] CDATA/malformed/all-skipped false-PASS regression tests
- [x] project-wide cross-process verification lock
- [x] explicit `CHECKING` operation instead of a forged task
- [x] Git-ignored declared input binding
- [x] Gate executable hashes and Java/Gradle/Maven metadata
- [x] declared profile and database dialect in source-bound config
- [x] canonical JSON hashes
- [x] structured path/credential redaction
- [x] append-only run history plus atomic latest record
- [x] `EXECUTED` versus `REPORTED` result authority
- [x] blocking Findings and non-gating Observation contracts
- [x] explicit network declaration and CLI approval
- [x] monotonically increasing executed-test baseline
- [x] runnable Gradle/JUnit backend example
- [x] isolated cold dependency-cache E2E using system Maven and a repository Gradle Wrapper

## 0.5 — Backend Packs

- [x] Gitleaks converter that discards secret-bearing fields
- [x] production-dialect DB integration-test recipe/Gate
- [x] executable architecture-test recipe/Gate
- [x] executable API/message contract recipe/Gate
- [x] conservative advisory Java/Kotlin import graph
- [x] Flyway duplicate comparison matching trailing-zero `MigrationVersion` semantics
- [x] prove Flyway migration, MySQL-specific behavior, and DB teardown after success, assertion failure, process failure, and timeout against a pinned disposable MySQL 8.4 container
- [ ] add a project-owned Atlas Findings recipe after its dialect/dev database lifecycle is specified
- [ ] add Liquibase-specific adoption evidence when a real project needs it

## Adoption proof still required

- [ ] run against two independently maintained backend repositories without modifying their source
- [ ] prove onboarding in 30 minutes or less with another developer
- [ ] record cross-machine agreement for fingerprint, verdict, Gate outcomes, and test counts
- [ ] compare direct local execution time with `bth check` overhead
- [ ] measure valid-finding rate for each optional static Pack
- [x] document a flaky-test policy that never converts a failed attempt into PASS

## 0.6 — Native source-bound planning and provider-neutral handoff

- [x] one-question-at-a-time requirement interview with explicit unknown/conflict states
- [x] deterministic Git/build/source/test/Flyway/policy/verification context snapshot
- [x] hash-chained interview history and hash-bound requirement/context/impact/plan artifacts
- [x] source-drift rejection before plan finalization and approval
- [x] crash-recoverable handoff into `PLAN_PROPOSED` with explicit human approval retained
- [x] approval receipt bound to context, plan, actor, time, and planned source
- [x] project-fact-aware question hints that never auto-answer human decisions
- [x] explicit answer revision and source/context rebind with immutable snapshots
- [x] approval bound to the canonical `plan.json` digest
- [x] provider-neutral read-only plan export without write or verdict authority
- [x] sealed failed-run diagnosis with exact rerun argv
- [x] bounded exhaustive state-machine invariant test
- [ ] execution adapters for specific coding agents; each must consume the same export and keep BTH verdict authority unchanged

## 0.7 — Safe adaptive feedback and budgeted code context

- [x] configured-order default and explicit per-Gate reorderability
- [x] contiguous required-Gate boundaries that fixed/optional Gates cannot cross
- [x] Beta-smoothed failure estimates with minimum observations
- [x] `p/c` ordering for the declared independent fail-fast model
- [x] bounded, symlink-safe, aggregate-only local history with corrupt-state fallback
- [x] complete schedule provenance in sealed run records
- [x] deterministic benchmark that preserves Gate identity and proves a scoped `3.61x` expected-feedback improvement
- [x] deterministic global PageRank in the advisory Java/Kotlin import graph
- [x] source/run/digest-bound Personalized PageRank context for approved plan export
- [x] hard context budget, provenance, limitations, and explained unavailable fallback
- [ ] measure real failure-feedback latency and Gate correlation on two independently maintained backends
- [ ] benchmark code localization with gold regions using Recall@budget and downstream completion

## Later, only with measured demand

- [ ] runtime coverage-to-test observation index
- [ ] runtime SQL/table observation index
- [ ] richer compiler/bytecode graph sidecar with per-edge provenance
- [ ] conservative test recommendations displayed as advisory only
- [ ] CI adapter that reuses the exact `verification.json`
- [ ] provider-neutral AI explanation of existing run records

## Explicitly out of the PASS oracle

- guessed Spring method calls
- scalar “confidence” presented as truth
- graph-based test skipping
- LLM-generated completion decisions
- automatic deployment or production DB access
- multi-agent runtime, memory engine, CRDT store, or SaaS dashboard

Model integration remains optional and last. A model may explain a run; it may not replace source binding, command execution, fresh reports, or the verdict contract.
