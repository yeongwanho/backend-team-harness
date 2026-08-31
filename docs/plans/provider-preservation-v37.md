# v37 — actual provider comparison after preservation changes

The previous goal turn was **progress**: runtime preservation/recovery/apply and
formatter diagnostics were implemented, verified and pushed as a4f0b674. The
3-independent-backend/20-task goal remains unchanged and incomplete.

## Measured work

1. Inspect current repository, CLI versions, disk and benchmark source. Preserve
   v35 scored workspaces and all historical results. No company repositories.
2. Run fresh `preservation-runtime-v36` pet-update BTH/direct Codex first attempts,
   sequentially, fixed model `gpt-5.6-sol`, fixed fast mode, one attempt per lane.
   Use the stronger five-case oracle, including foreign-owner preservation. Both
   lanes must pass identical baseline/oracle controls before model execution.
3. Read source diffs and ordinary/independent test outcomes. Keep failed first
   attempts failed. If repair is needed, perform a separately labelled bounded
   recovery run, never overwrite or count it as success@1. Diagnose any harness
   defect before patching, with a failing regression and updated protocol when
   changing measured runtime semantics.
4. If safe capacity remains, run the already-validated visit task as a new actual
   paired case. Do not repeat unchanged controls indefinitely or start concurrent
   heavy JVM clones. Pause new heavy runs below 2 GiB free; never delete shared
   caches, retained evidence or user work to make room.
5. Check current Claude availability using actual task execution only if the
   previous known quota condition can reasonably have changed; do not treat an
   installed CLI as available inference or a quota denial as a model evaluation.
6. Write sanitized reproducible evidence and an updated 20-task ledger. Report
   success@1, rule/verification outcomes, localization, times, tokens, unknown cost
   and retry counts separately. No pooled success claims across protocols.
7. Run evidence consistency/docs/syntax tests plus scoped/full tests for any runtime
   patch. Review, commit and push only this work; keep the overall goal active.

## Outputs and guardrails

- Raw task-owned output: `/tmp/bth-v37-pet-pair`, `/tmp/bth-v37-visit-pair`.
- Planned report: `docs/evidence/provider-preservation-v37.md` with sanitized
  records under `docs/evidence/artifacts/v37/`.
- Fixed CLI version/protocol/source/oracle hashes recorded. No hidden test body or
  gold Git history supplied to implementation providers.
- Runtime writes only in disposable synthetic/public workspaces. No deployment,
  production DB, company source mutation, global credential/config change or
  unsupported network-isolation claim.
- The goal is developer task completion, not merely increased test count or
  preservation-check rejection rate. A rejected unsafe candidate is a safety
  improvement but still a failed first-attempt implementation.

## Verified counterexample and corrective scope

Read-only comparison of the historical `spring-01-pet-association` base and target
proves v36 rejects the intended change: the requirement explicitly permits
associating an already-persisted pet, which necessarily changes the old `isNew`
guard. Treating every observed guard as an immutable policy violates the product
goal's separation of discovered observations and team-declared policy.

After the already-running v36 pair terminates, implement:

1. `src/core/preservation-review.mjs` and tests: derive a review fingerprint from
   the sealed candidate record plus current bounded findings. Explicit actor,
   exact fingerprint and non-secret rationale are required to acknowledge a
   structural change. Incomplete inspection is not overrideable. This is human
   acknowledgement, not a semantic proof or authenticated identity service.
2. `src/runtime/implementation-orchestrator.mjs` and preservation guidance: a
   syntactic guard change alone must not force a model to undo an intended
   requirement or consume blind repair attempts. Run required tests, retain the
   review signal, and expose a separate apply-review state. Real test failures
   still enter bounded repair; incomplete analysis remains non-confirmed.
3. `src/runtime/implementation-apply.mjs`: normal `--allow-write` still cannot
   apply unresolved drift. Only the exact current review fingerprint plus note
   can acknowledge it; source/diff/seal/staging/rollback checks stay mandatory.
   Record the acknowledgement in the apply receipt without rewriting old records.
4. `src/cli/implement-command.mjs`, `src/cli/help.mjs`,
   `src/runtime/work-orchestrator.mjs`: show pending review plainly; support
   `--accept-preservation-review <sha256> --review-note <text>` on apply only.
   Do not describe passed tests with pending review as fully completed work.
5. Tests: intended changed guard can finish tests once and await review; no
   acknowledgement, stale/wrong hash, missing/secret note and changed candidate
   must refuse apply. Explicitly reviewed current candidate may apply. Old seals
   are rechecked, incomplete scans cannot be overridden, and genuine failing
   tests still consume only the configured retry budget.
6. Advance fresh benchmark identity to `reviewable-preservation-v37`. Preserve
   the ongoing v36 actual first-attempt records unchanged. Re-run syntax, docs,
   complete tests/coverage, mutation and packed installation after runtime edits.

This does not automatically approve the known unsafe pet-update candidate.
Its actual behavior must be measured independently; only a person who reviewed
the specific final diff may choose the explicit acknowledgement flow.

## Progress

- [x] Freeze and complete actual v36 Codex pet pair; preserve BTH failure/direct success.
- [x] Independently test unchanged rejected BTH candidate: four behaviors pass,
  foreign-owner preservation fails. No first-attempt score rewritten.
- [x] Write failing-first regression tests for intended change, approval and old seals.
- [x] Implement candidate-bound review, CLI/status/receipt and normal test execution.
- [x] Pass 563 tests (4 explicit skips), coverage gate, 37 curated mutations,
  packed install, Windows contracts and production dependency audit.
- [x] Replay historical authorized change in a disposable real Java project:
  76 tests pass, unacknowledged apply refused, acknowledged fixture apply and
  integrated 76 tests pass. Zero model inference; not a success@1 sample.
- [x] Complete fresh visit Codex pair under v37: both first attempts fail on
  Java formatting before tests. BTH uses more total/uncached tokens in this pair.
- [x] Record the actual pair and refresh the ledger: eight distinct historical
  paired tasks, not a pooled success rate; ten current validated oracles of twenty.
- [x] Finish source/evidence review and verify recorded runtime hashes match the
  tested files. Publication is confirmed separately by the Git remote check in
  the task handoff, not inferred from this checklist. The overall goal stays active.
