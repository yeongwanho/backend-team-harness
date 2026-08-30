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
- [x] deterministic analytical fixture that preserves Gate identity and calculates a scoped `3.61x` expected-feedback improvement under the declared model
- [x] deterministic global PageRank in the advisory Java/Kotlin import graph
- [x] source/run/digest-bound Personalized PageRank context for approved plan export
- [x] hard context budget, provenance, limitations, and explained unavailable fallback
- [ ] measure real failure-feedback latency and Gate correlation on two independently maintained backends
- [x] benchmark code localization on a versioned synthetic gold fixture using Recall@5 and Recall@20
- [ ] benchmark real-project gold regions and downstream completion

## 0.8 — Independent hardening and portable team evidence

- [x] direct-process exit handling with bounded stdio drain and leaked-descendant cleanup
- [x] distinct failed-Gate evidence when a descendant keeps inherited stdio open
- [x] nested-backend source binding based on the project `HEAD` manifest rather than sibling commits
- [x] per-file and aggregate bounds for untracked and declared source inputs
- [x] unique JUnit report ownership across combined architecture, contract, and database Packs
- [x] configuration rejection for exact report-pattern ownership collisions
- [x] conservative rejection of overlapping wildcard report trees
- [x] pre-Gate removal of owned structured reports so timestamp-only reuse cannot mint evidence
- [x] dedicated report-directory requirement plus tracked/non-ignored deletion refusal
- [x] portable DONE transition from a committed, sealed run summary when local detail is absent
- [x] portable summary restricted to `VERIFIED -> DONE` with stable source, positive executed tests, and all required Gates
- [x] exact 0.7 fingerprint compatibility for unchanged approved/verified tasks
- [x] tamper-evident baseline updates with normal command-symlink policy parity
- [x] PID-reuse-aware stale lock recovery where the host exposes process-start identity
- [x] conservative foreign-host lock ownership
- [x] bounded history eviction for obsolete Gate signatures
- [x] explicit PageRank tolerance and convergence telemetry
- [x] narrow Docker/Testcontainers routing environment without credential passthrough
- [x] ambient Testcontainers reuse and Ryuk-disable flags excluded from child processes
- [x] bounded, waited `SIGTERM`/`SIGKILL` cleanup for leaked descendant stdio
- [x] queued-output-safe hash finalization and settle-guaranteed drain cleanup
- [x] underscore-delimited environment credential redaction
- [x] unambiguous separation between human review checklists and executable Gates
- [x] human review checklists rendered in exported plan Markdown
- [x] copyable Gradle architecture-task snippets
- [x] default Gradle test exclusion for separately executed architecture tests
- [x] approved-plan export serialized with verification/report generation
- [x] Unicode-aware, human-value-only plan localization terms
- [x] package/CLI version synchronization from one package manifest
- [x] fail-closed symbolic-link policy for dedicated structured-report trees
- [x] 16 MiB per-report and 64 MiB aggregate collection bounds with sequential parsing
- [x] compact bounded Pack writers aligned with the codegraph loader limit
- [x] bounded code-context authority metadata independent of entry budget

## 0.9 — Project intelligence, semantic impact, and isolated implementation

- [x] strict provenance-carrying project rule contract with confirmed/unknown/conflict evaluation
- [x] deterministic Git, knowledge-document, build, JVM, Flyway, dialect, and Gate fact collection
- [x] blocker project rules surfaced in interview hints and enforced before plan finalization
- [x] multi-declaration Java/Kotlin graph with import, inheritance, implementation, injection, and test provenance
- [x] iterative SCC analysis safe beyond the JavaScript call stack
- [x] directional dependency/dependent localization and weighted Personalized PageRank
- [x] explicit Gate dependency ready-set scheduling
- [x] opt-in bounded parallel batches with distinct resource classes
- [x] provider-neutral project-owned implementation adapter contract
- [x] external detached task worktree with explicit write approval, explicit network-risk acknowledgement, and bound-source breach evidence
- [x] allowed-prefix, changed-file, diff-byte, and verification-control-plane guards
- [x] bounded repair attempts driven by structured verification failure summaries
- [x] immutable-base diff detection even when an adapter commits, plus file-level integration proof before verify
- [x] per-user ownership-checked worktree root, running-record crash recovery, hidden-index/ref rejection, and task-audited destructive reset
- [x] exact dependency-constrained sequential Gate scheduling up to 18 Gates with honest heuristic fallback labels
- [x] no automatic commit, merge, deployment, production access, or task VERIFIED transition
- [x] incremental source index cache measured on a large real backend (explicit warm, read-only reuse, source-fingerprint invalidation, 1/1551-file reparse evidence)
- [x] versioned synthetic gold impact fixture with Recall@20 >= 0.85 (current 1.0; not production proof)
- [ ] independently maintained second backend validation
- [ ] path-scoped isolated implementation for a harness rooted below a monorepo Git top-level

## 1.0 — Team intelligence boundary (unreleased)

- [x] bounded project-owned `project.*` facts with provider/version authority and exact Markdown provenance
- [x] provider disagreement becomes conflict and project facts cannot replace built-in fact authority
- [x] question-scoped structured claims and deterministic contradiction candidates
- [x] digest-bound human contradiction resolution required before interview finalization
- [x] single active task authoring writer with audited epoch handoff
- [x] fail-closed detection of Git-unmerged task/interview ledgers before hash replay
- [x] synthetic impact Recall@5/Recall@20 regression gate through the production ranking API
- [ ] two-developer adoption run with a real handoff and measured merge-conflict rate

## 1.1 — Built-in implementation providers (unreleased)

- [x] explicit Codex CLI and Claude Code provider configuration with legacy command-adapter compatibility
- [x] PATH resolution, version probe, filtered environment, `shell: false`, and no dangerous sandbox-bypass flags
- [x] deterministic fast/balanced/deep context and effort profiles with conservative auto fallback, compatible single-module CRUD fast path, and no-change one-attempt stop
- [x] source-bound bounded code context, approved plan, write policy, authority limits, and compact recovery request
- [x] detached-worktree implementation followed by the unchanged complete verification Gate contract
- [x] bounded numeric token/cost telemetry recorded as advisory evidence only
- [x] mock-provider end-to-end edit, write-policy, recovery, and verification tests
- [x] one Codex and one Claude full-path implementation smoke on separate synthetic Java repositories, including real edit and Gate execution
- [ ] measured real-provider implementation on two unrelated backend tasks
- [ ] compare tokens, time, valid edit rate, and repair rate against direct Codex/Claude execution
- [ ] lightweight non-writing question/inspection router; implementation profiles do not yet turn BTH into a chat harness

## Later, only with measured demand

- [ ] optional trusted-CI signature/attestation policy for organizations that need hostile-author assurance
- [ ] Windows CI proof for wrapper execution and descendant-process cleanup (hosted wrapper smoke added; descendant cleanup still needs a native leak fixture)
- [ ] explicit lock inspection/unlock workflow with the same ownership safeguards
- [ ] starter recipes for non-JVM backends, driven by measured team demand
- [ ] runtime coverage-to-test observation index
- [ ] runtime SQL/table observation index
- [ ] team-declared per-module Gate activation with conservative cross-module fallback and measured no-false-skip evidence
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
