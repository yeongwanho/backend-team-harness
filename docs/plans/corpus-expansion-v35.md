# v35 — expand actual paired execution, not just features

The preceding turn is verified progress: d11e233 is pushed; FastAPI and a new
Spring task were actually compared. The full three-repository/twenty-task goal
remains active and is not replaced by this increment.

## Current-state constraints

- Clean task branch `codex/company-pilot-p0`, HEAD d11e233 at start.
- About 4.7GiB free. Do not prune Docker, shared caches, user files or historical
  evidence. Check space before each experiment; stop adding new cases below
  2GiB. Prefer cached public dependencies, serial execution and owned temp clones.
- Claude previously stopped at quota before inference. Do not silently switch
  accounts/models or count that as a completed model evaluation.
- Reuse the existing fixed v34 protocol, same Codex model (`gpt-5.6-sol`), fast
  profile and one attempt on each lane. Do not tweak prompts after seeing a result.

## Execution units and verification

1. Recheck corpus/config and independent oracle coverage for Spring future visit
   dates, binder ID protection and pet update persistence. Read the exact pinned
   acceptance fixtures; retain failed outcomes if they disprove readiness.
2. Run each task through the existing paired runner in a new `/tmp/bth-v35-*`
   output directory. Each case first verifies base readiness and base/target
   behavioral controls, then performs isolated provider edits and fresh ordinary
   plus independent verification. No company source or production DB.
3. For each actual candidate, inspect the diff, preserve source hashes, original
   test-case inventory and final outcomes in `docs/evidence/artifacts/v35/`.
   Distinguish final correctness, first-attempt failures and infrastructure errors.
   Keep source workspaces until audit material is captured; never erase evidence
   simply to free space.
4. Audit all twenty task rows from current corpus and saved evidence. Separate
   configured oracle, independently validated oracle, actual invocation and
   successful pair. Different protocols/configs are historical observations, not
   a pooled statistical speed estimate. Publish a concise report and remaining
   blockers rather than a completion percentage.
5. If a run exposes a harness defect, reproduce it with a focused failing test
   before editing the minimum runtime/test files; keep the original failure and
   explicitly version any changed experiment. Otherwise do not change runtime.
6. Check evidence JSON, hashes, redaction/path exposure, links, CLI documentation
   contract and git diff. Run additional tests proportional to any runtime edit.
   Commit and push only the verified scope; leave the full goal active.

## Pre-execution oracle correction (before the visit provider sees the task)

The visit fixture requires `typeMismatch.visitDate` and edits to eight specific
property bundles. Neither implementation choice is required by the corpus text.
Change only `fixtures/spring/VisitAcceptanceTests.java`: assert date field errors,
tomorrow on the actual new-visit form, and nonempty, resolved, rendered English and
German messages that differ by locale. Keep future acceptance, minimum-date and
description checks. Bind the changed file hash and case name in
`provider-comparison.json`. Keep binder/pet runs on their original protocol and
config; only then version the runner for the corrected visit experiment.

Before paid visit execution, run real Maven negative/base and positive/target
controls. Also test a target variant with renamed message keys (same behavior),
a Bean Validation `@Future` alternative, and a variant whose German error falls
back to English. Expected outcomes: base FAIL, target PASS, alternatives PASS,
unlocalized variant FAIL. Retain the original v31 fixture evidence, and record
all hashes/control outcomes; no post-result prompt changes.

`scripts/check-visit-oracle-variants.mjs` retains this model-free experiment for
reproduction with a caller-provided public mirror cache. It only writes and
removes its own fresh variant clones; preserves exact source hashes and output
on stdout, and formats synthetic variants with their pinned Maven formatter.
Verify argument rejection, fixture pins, and actual Maven outcomes. Temporary
format-check failures are retained separately and never counted as regressions.

## Supplemental ownership audit (not a retrospective first-attempt score change)

The pet candidate passed the original four-case oracle, but adds `Owner.updatePet`
with an unrestricted fallback and creates a Pet for an unmatched owner/pet ID.
Before calling that candidate ready, add an evaluator-owned
`PetOwnershipAcceptanceTests.java` fixture and run it in fresh base, target and
candidate clones. Attempt an update with another owner's persistent pet ID and
compare the actual H2 row's owner/name/date/type after flush/clear. Base/target
must preserve it; record the candidate outcome without mutating scored source.
Also inspect the direct candidate. Keep this post-hoc regression audit distinct
from the predeclared four-case acceptance score. Do not publish a security
exploit claim unless the actual row change is reproduced.

The valid-length-input audit reproduced an owner_id change from 2 to 1 on the
BTH candidate, with base and target unchanged. Promote that fixture to the
next-version pet oracle (two fixture files/reports, five cases), preserving
the v34 four-case score. Verify combined base FAIL / target PASS / original BTH
candidate FAIL before any further provider experiment. Actual visit provider
execution is deferred behind this newly reproduced correctness gap; this does
not replace or complete the full goal.

## Verified outcome

- Actual Codex BTH/direct pairs completed for binder and pet tasks under v34.
- Both BTH candidates passed original gates; both direct candidates stopped at
  formatting. Pet BTH subsequently failed an independent ownership regression.
- Strengthened five-case pet oracle: base regression reproduced, target passes,
  retained BTH fails only the ownership case. No scored candidate was repaired.
- Visit oracle: renamed-key and Bean Validation alternatives pass; unlocalized
  variant fails. An ENOSPC interruption was not counted, peak variant retention
  was reduced, and the complete model-free experiment was rerun successfully.
- Scoped Node QA 45/45, syntax and docs contract pass; corpus ledger rebuild and
  evidence links verified. No runtime `src/` edit, company source or production DB.
- Full goal is unfinished. Next prioritize generic preservation of existing
  ownership/association guards and structured pre-test failure recovery. Do not
  treat manually fixing the Petclinic candidate as fixing the general harness.
