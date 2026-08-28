# Roadmap

This file separates shipped runtime from intended work. A checkbox counts only when a CLI call path and acceptance tests exist.

## Milestone 0 — Safe foundation (shipped)

- [x] existing-project and Git/backend-root validation
- [x] symlink-safe `.backend-harness` initialization
- [x] no-clobber default and recoverable `--force` backups
- [x] content-aware repository doctor
- [x] strict quality-gate YAML parser
- [x] CI and regression tests

## Milestone 1 — Task contract (shipped MVP)

- [x] human-readable task document
- [x] explicit unknown starting state
- [x] task transition table with rejection audit
- [x] human approval requirement for `PLAN_APPROVED`
- [x] replayable JSONL event store and snapshot
- [x] path-safe task ids and local concurrency lock
- [ ] source manifest and staleness detection
- [ ] conflict merge for task events created on separate Git branches

## Milestone 2 — Deterministic verification (shipped MVP)

- [x] named tool registry
- [x] pre-execution task/permission gate
- [x] project Gradle/Maven Wrapper selection
- [x] fixed offline commands with no shell string
- [x] allowlisted child-process environment
- [x] exit-code, timing, and output-hash evidence
- [x] `VERIFIED` and `DONE` require confirmed evidence
- [ ] selected module/test targeting with a validated schema
- [ ] JUnit XML result parsing
- [ ] evidence baseline comparison

## Milestone 3 — Spring impact analysis

- [ ] module and package map
- [ ] Controller → Service → Repository trace
- [ ] DTO and endpoint change candidates
- [ ] related test discovery
- [ ] multi-repository relationship pack

## Milestone 4 — Backend quality adapters

- [ ] released Flyway migration baseline and immutability check
- [ ] JPA entity, transaction, and query-risk inspection
- [ ] OpenAPI compatibility gate
- [ ] secret-pattern scanning before evidence export

## Milestone 5 — Team handoff

- [ ] implementation decision log commands
- [ ] verified/unverified/blocked summary
- [ ] handoff packet import/export
- [ ] before/after evaluation suite

## Milestone 6 — Model providers

- [ ] provider-neutral request/response contract
- [ ] minimum-context and redaction policy
- [ ] one provider adapter plus a deterministic fake-model test
- [ ] Codex, Claude, GPT, and local-model adapters
- [ ] replayable evaluation cases

Model integration is deliberately last. A model may interpret evidence, but it must not replace the state, permission, tool, or evidence contracts already enforced by the core.
