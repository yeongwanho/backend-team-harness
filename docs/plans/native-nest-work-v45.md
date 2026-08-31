# v45 — Third-backend native work and missing document-update oracle

## Objective

Continue the unchanged three-independent-backend/twenty-task objective. Extend
actual native execution to NestJS, and add the missing independent behavioral
oracle for `nest-04-document-find-update`. Do not count an empty test baseline,
mocked persistence contract, unavailable dependency, or interrupted provider as
an end-to-end success. Keep company data/repos, real provider settings, caches
and older retained implementation candidates untouched.

## Evidence and scope

- HEAD before work: `2e38f5fd64d930f261c278941960db423f6e4fac`.
- `src/evaluation/task-acceptance.mjs` holds base/target/candidate directories until
  the entire evaluation exits. Each Nest fixture installs its own dependencies;
  keeping completed stages alive needlessly multiplies peak disk use.
- `inspectEmptyTestBaseline` permits first-test creation only for exact generated
  Jest verification, stable zero-test discovery and an offline npm preparation
  contract. Final verification still requires at least one executed test.
- Existing `nest-06-user-email-conflict` already has an independent oracle, but no
  native project fixture. Use its original generated verification templates, not
  fabricated passing tests, to exercise first-test authoring.
- Missing `nest-04` affects user/session document repositories and both Hygen
  document repository generators. The target adds post-update return selection
  at four persistence calls. Check runtime return values, null and failure cases,
  not an exact textual patch or implementation-only option string.

## Atomic changes and verification

1. `test/task-acceptance.test.mjs`: add failing checks proving that a completed
   base snapshot is gone before target execution, target is gone before candidate,
   and original dirty files survive success and exceptions.
2. `src/evaluation/task-acceptance.mjs`: release each completed owned stage once
   its source-bound result/report hashes have been captured; keep outer-finally
   cleanup for exceptions. No shared/caller path cleanup.
3. `scripts/acceptance-controls.mjs`: bind evidence to the isolated snapshot helper
   as well as the evaluator. Run selected public controls serially with cached
   dependencies; no provider calls in this stage.
4. Add `fixtures/nest/document-update.spec.ts` and its Jest config, reusing the
   pinned offline runner/JUnit adapter. Exercise actual repository methods and
   rendered generated code against a mocked Mongoose boundary. Preserve source
   input, mapping, null and rejection behavior. Do not claim live MongoDB proof.
5. Add a hash-bound acceptance definition for `nest-04` in provider-comparison.json
   and a contract test. Validate all expected cases execute on both original and
   target; source errors and missing dependencies remain unknown, not regression.
6. Prepare a disposable `nest-06` checkout; read and pin its generated portable
   wrapper/config into evaluation fixtures, with explicit offline preparation.
   Leave original scripts, lockfile, production code and test discovery unchanged.
   Ensure `no-tests-discovered` remains unconfirmed rather than an empty pass.
   Discovery: generated config protects its launcher through `gate.command`, not
   a redundant `inputs` entry. Fix `project-fixture-config.mjs` to recognize this
   already-protected command without mutating the exact generated contract. Add
   a failing parser regression; unrelated unbound files must still be rejected.
7. After safe preparation is verified, seal sources and run actual BTH/direct
   native workflows on the same task/provider/mode/budget, retaining candidates.
   No manual correction of scored code; separate diagnostics never replace scores.
8. Record measured results, disk limitations, model/usage unknowns and the corpus
   ledger under `docs/evidence/artifacts/v45`. Run targeted/full regression,
   curated mutation, syntax/docs/install checks, secret scan, and push verified
   changes. No twenty-task completion or universal speed claim from this stage.

## Resource and stop boundaries

Only about 941 MiB was free at start. Avoid simultaneous dependency-heavy stages.
Measure the first cached npm install before attempting multiple retained workspaces.
If native setup cannot fit safely, preserve its diagnostic and continue useful
oracle/runtime work; do not delete user caches or quietly weaken verification.
No automatic production DB, app startup, cloud service or E2E network access.

## Execution outcome

- Items 1–6 implemented and verified: immediate stage cleanup, protected command
  compatibility, four-path document oracle, exact generated Nest baseline.
- Item 7 is **not executed**: real npm dependencies occupy about 457 MiB and
  concurrent retained native workspaces exceed available headroom. The real
  single-clone empty-test baseline was verified, not scored as implementation.
- New oracle base: 4 failed/16 passed; target: 20 passed. Previous controls:
  10/11 valid, with session-hash blocked by the current npm package/lock mismatch.
- Final full coverage: 623 pass/4 environmental skips/0 fail. The parser mutation
  test was refined to assert its expectation explicitly; 40 targeted tests cover
  the final changes, including generated-project checkout with autocrlf=true.
  All 53 curated mutations are caught by executed assertions. No proof from raw
  Error crashes.
- Pre-commit Git staging exposed CRLF normalization of the hash-pinned native
  Windows wrapper. Scope `-text` to that fixture and add a real Git blob check
  with forced-conversion control and autocrlf input/true/false. Earlier QA is
  preserved as `qa.json`; `qa-final.json` supersedes it for the final tree.
- Follow through the same Git boundary in generated projects: add a scoped
  byte-preserving `.backend-harness/.gitattributes` template and protect it
  as a verification input. Test fresh init/commit/snapshot equality, pin this
  fourth native fixture, rerun the actual empty baseline after a Git round trip,
  and record it separately from the earlier single-working-tree probe.
  Preserve JSON contracts and all generated wrapper bytes, including checkout
  with autocrlf=true. Allow only this exact Git metadata path as an additional
  project fixture; verification/implementation JSON replacement remains rejected.
- Remaining full objective: native Nest implementation, all twenty tasks and
  measured BTH/direct comparisons, including unresolved policy/Windows limits.
