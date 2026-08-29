# Native execution-plan interview implementation plan

## Goal

Add a first-class, no-model `bth interview` workflow that turns an initial backend requirement into reviewable, source-bound requirement, repository-context, impact, and execution-plan artifacts. The workflow must ask only project decisions, reuse deterministic repository facts, and hand the completed plan into the existing task approval lifecycle.

The implementation must not execute or depend on Gajae Code, Ouroboros, Oh My Pi, OMO, or any model provider.

## Working set

- `src/core/interview-state.mjs`: interview schema, question catalogue, validation, answer transitions, closure rules.
- `src/core/interview-store.mjs`: symlink-safe, lock-protected, hash-chained persistence inside the existing task directory.
- `src/adapters/project-context.mjs`: bounded deterministic repository facts and provenance.
- `src/runtime/interview-orchestrator.mjs`: start, answer, status, and finalize operations plus task-lifecycle handoff.
- `src/cli.mjs`: `bth interview start|answer|status|finalize` commands and human/JSON output.
- `test/interview-state.test.mjs`: unit tests for question ordering, invalid answers, unknowns, and closure.
- `test/interview-store.test.mjs`: replay, tamper, concurrency, path, and interruption tests.
- `test/interview-orchestrator.test.mjs`: source facts, generated artifacts, task handoff, stale-source refusal.
- `test/cli.test.mjs`: real CLI workflow and non-zero invalid-input behavior.
- `README.md`, `docs/ARCHITECTURE.md`: user workflow and architectural boundary.

## Atomic implementation and verification units

1. Define the versioned interview record and fixed decision areas: objective, acceptance criteria, allowed scope, data/migration impact, verification, and exclusions/risks.
   - Verify every question has a stable id, bounded answer, and explicit required/optional semantics.
   - Verify unknown/conflicting required decisions cannot finalize.
2. Add bounded repository discovery with provenance.
   - Record Git source fingerprint, project/build indicators, declared verification gates, Flyway files, test-source presence, and policy documents.
   - Never claim semantic completeness; findings are `confirmed` facts or `unknown`.
3. Add crash-safe interview storage under `.backend-harness/tasks/<id>/interview/`.
   - Use project/task locks, atomic snapshots, append-only hash-chained events, safe ids, and symlink rejection.
   - Verify tampering and concurrent answers fail closed.
4. Implement `start`.
   - Create the existing task and an interview bound to the current source fingerprint.
   - Persist `context-snapshot.json`, the first pending question, and provenance.
   - Refuse duplicate tasks, empty requirements, uninitialized projects, or unsafe paths.
5. Implement `answer` and `status`.
   - Accept only the current stable question id, actor, and bounded text.
   - Preserve every answer and expose the next pending question without model calls.
   - Refuse stale/out-of-order answers and completed interviews.
6. Implement `finalize`.
   - Re-capture source and refuse drift from the interview baseline.
   - Require every required decision and no unresolved required unknown.
   - Write structured and readable requirement, context, impact, and plan artifacts.
   - Update existing task context/plan and advance it to `PLAN_PROPOSED`, leaving human `PLAN_APPROVED --approve` unchanged.
7. Wire CLI commands and help.
   - JSON mode must expose stable machine-readable statuses and file paths.
   - Human mode must show one question at a time and the exact next command.
   - Invalid input must exit non-zero.
8. Add failure-first tests before accepting the implementation.
   - Unapproved work remains impossible through the existing lifecycle.
   - Missing acceptance criteria, stale source, answer mismatch, tampered log, symlink target, duplicate start, and oversized answer all fail.
   - No external harness name appears in runtime imports, dependencies, or subprocess calls.
9. Run `npm test`, `npm run check`, CLI smoke tests, and the real JVM gate when the change touches only task/orchestration surfaces.
   - MySQL real E2E is not required unless DB verification runtime changes; existing DB tests must remain green in the normal suite.
10. Review the final diff against this plan, update docs, commit the feature branch, and push only the new BTH branch after all checks pass.

## Acceptance summary

A developer can initialize any supported backend repository, start a native BTH interview, answer one deterministic question at a time, inspect persisted facts and decisions, finalize a source-bound plan, and then use the existing explicit approval and verification workflow. The same flow works with no model and no external harness installed.

## Implementation result

- Implemented all four CLI operations and the five-question state machine.
- Added deterministic project-context capture, source-drift rejection, hash-chained storage, artifact integrity checks, and crash-recoverable task handoff.
- Strengthened task approval with planned-source validation and a context/plan hash receipt.
- Added unit, storage, orchestration, concurrency, tamper, source-drift, and real CLI tests.
- Verified with `npm run check`, `npm run test:real-jvm`, and `npm run test:real-db` on 2026-08-30.
