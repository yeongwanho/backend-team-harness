# Rule-aware fast path v13 — QA evidence

Date: 2026-08-31

## What was tested

- Failing-first provider-profile and request-contract tests for unresolved rules, rule conflicts, missing adjacent code, bounded convention metadata, and provider instructions.
- End-to-end synthetic backend flow: native interview with structured claims → source-bound codegraph Gate → human-bound approval → automatic provider profile → detached implementation worktree → every declared Gate.
- Full Node regression suite and syntax check.
- Windows command-contract suite.
- Real Maven and Gradle wrapper/JUnit execution.
- Real MySQL migration and integration behavior through the DB Pack.
- Adaptive Gate-order benchmark.

## What was observed

- Before implementation, the new tests failed because automatic `fast` ignored project-rule readiness and provider schema v2 had no `projectConventions` contract.
- The first end-to-end fast-path attempt exposed an over-conservative behavior: one unknown non-blocking DB warning forced an unrelated non-DB CRUD task to `balanced`. The final policy keeps that warning visible, permits fast when all blockers and adjacent-code evidence are confirmed, raises a known non-blocking conflict to balanced, and raises a blocker conflict to deep.
- `node scripts/check-syntax.mjs && npm test`: 294 tests, 292 passed, 0 failed, 2 environment-gated tests skipped.
- `npm run test:windows-contract`: 8 passed, 0 failed.
- `npm run test:real-jvm`: 3 passed, 0 failed (real Maven and Gradle subtests).
- `npm run test:real-db`: 1 passed, 0 failed (real MySQL container, migrations, and integration behavior).
- `npm run benchmark:adaptive`: 3.612661318451343x analytical expected-feedback speedup with all three required Gate identities preserved.
- The automatic fast integration request selected `fast`, recorded project-rule and adjacent-code readiness as confirmed, retained the unknown non-blocking warning, included ranked production and test paths, and still executed every required Gate.

## Why this is enough

The focused tests cover the new selection branches and bounded request shape. The end-to-end test proves the branches are connected through the actual interview, sealed graph, provider request, isolated edit, and verification orchestration instead of only testing helpers. Full regressions cover task state, approval, source binding, permissions, evidence seals, recovery, build discovery, Windows launching, database Packs, and Gate scheduling. Real JVM and MySQL runs confirm that the implementation did not merely pass synthetic parser fixtures.

## What was omitted

- No production repository, production database, deployment, merge, or external write was used.
- No real Codex or Claude source edit was required for this deterministic routing change; provider invocation is exercised through the existing real CLI runner fixture and a bounded mock provider in the end-to-end orchestration test.
- Standard-suite environment-gated JVM and MySQL cases are skipped by design; both were executed separately with their explicit opt-in environment variables and passed.
- Raw provider output, credentials, environment dumps, private repository paths, and secret-bearing logs were not recorded.
