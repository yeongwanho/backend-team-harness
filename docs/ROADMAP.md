# Roadmap

## Milestone 0 — Foundation

- safe `.backend-harness` initialization
- repository doctor
- shared policy and workflow templates
- CI and regression tests

## Milestone 1 — Task contract

- one human-readable task document with structured front matter
- context snapshot and source manifest
- explicit unknown and conflict handling
- task state machine with resumable local storage

## Milestone 2 — Spring impact analysis

- module and package map
- Controller → Service → Repository trace
- DTO and endpoint change candidates
- related test discovery

## Milestone 3 — Deterministic verification

- allowlisted Gradle/Maven commands
- test-result evidence
- Flyway immutability and ordering checks
- OpenAPI compatibility gate
- secret redaction

## Milestone 4 — Team handoff

- implementation decision log
- verified and unverified work summary
- handoff packet import/export
- before/after evaluation suite

## Milestone 5 — Model providers

- provider-neutral request/response contract
- Codex, Claude, GPT, and local-model adapters
- minimum-context and redaction policies
- replayable evaluation cases

