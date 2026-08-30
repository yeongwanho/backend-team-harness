# Failure diagnosis, bounded context, and real recovery v27

Previous goal turn is progress: 28f279a is pushed and contains actual adverse Nest
comparisons. The full 3-backend / 20-task / Codex-and-Claude goal stays ACTIVE.
It is not redefined as a single successful recovery or green library tests.

## Observed paths

- `runWork -> runImplementation -> compactVerification -> recoveryInput` keeps
  failed test names, but drops result-level reason, exit state, and test totals
  from recovery. Benchmark observations drop failed names as well.
- `bth diagnose` only loads a task verification run. An IMPLEMENTING task with a
  failed implementation can have no such run, so this normal failure is invisible.
- Paid v26 candidates were deliberately cleaned up. Their exact source and
  assertion failure are unavailable; do not invent a root cause or reclassify
  those failures. Preserve future audit candidates explicitly.
- BTH's v26 request was 20,960 bytes versus 1,838 for direct. This is a measurement,
  not proof of which fields are redundant. Inspect an unpaid real-repo request
  and measure field sizes before projecting more aggressively.

## Atomic implementation and verification units

1. An owned temporary public Nest base clone and a non-model provider stub:
   capture one current request, report per-field size, then remove its owned
   implementation worktree. No model tokens, deploy, real DB, or company source.
2. New `src/core/implementation-verification.mjs`: a shared bounded diagnostic
   projection used by runtime recovery and benchmark evidence. Preserve failed
   Gate IDs, structured reason, test counts and failed test identities, process
   exit/timeout state, source fingerprint. No stdout/stderr, assertion bodies,
   SQL values or source contents. Redact known sensitive identifiers and cap
   strings/lists; mark advisory. Unit-test limits, absence, failure classes,
   secret-bearing test names, and no accidental verdict promotion.
3. `src/runtime/implementation-orchestrator.mjs`: replace duplicated compaction
   with that helper, include actionable bounded recovery, and point failed users
   to `bth diagnose`. Preserve all existing approval, no-change, source-integrity,
   required Gate and retry-budget checks. Verify real worktree recovery requests.
4. `src/runtime/failure-diagnosis.mjs`: diagnose the sealed implementation record
   for IMPLEMENTING tasks before trying a separate task verification record.
   Do not hide malformed seals or show an old failure after a passed current run.
   Report original-source mismatch rather than pretending the record is current.
   CLI regression for preparation failure, failed tests, passed run, tampering,
   source drift, and the existing VERIFY_FAILED route.
5. `src/evaluation/provider-benchmark-runner.mjs`: preserve the shared bounded
   failure summary and per-attempt outcome in both lanes. Keep first-attempt and
   eventual success separate; no success-at-1 after repair. Test non-promotion and
   redaction. Public pilot retains owned candidates explicitly for diagnosis.
6. Only after measurement, change `src/core/provider-context.mjs` if a defensible
   redundant projection exists. Every declared rule/status/source, blocking
   condition, approval and code entry ranking must survive. Preserve a path to
   full evidence. Add projection invariants and before/after bytes; no token or
   performance claim from byte savings alone.
   Measurement: 21,068B total; approved task 6,659B, conventions 9,976B (layers
   5,242B), code context 3,518B. A real AuthController became an entity because
   `rolesFor` matched a domain import against a path regex on path+content.
   Fix `src/core/portable-project-index.mjs`: path-only classification, masked
   code-only markers/declarations, ignore comment/string route/table lookalikes.
   Reuse migration discovery's static JS/Python masking in a small shared module;
   re-run migration and portable-index regressions. Provider-only package lists
   may be bounded to selected code neighborhoods with explicit omission counts;
   keep the full approved task and all declared policy unchanged.
7. Run actual Nest implementation with inspectable owned workspace and bounded
   attempts. Diagnose the actual failed case, if any, without exposing hidden
   oracle tests to the provider. Verify a real repair only from observed failing
   Gate -> changed source -> passing full Gate -> independent acceptance. Record
   each attempt, total tokens/time and failures; do not repeatedly call until a
   good sample appears. Extend normal paired comparison only with a new protocol
   and unchanged task/provider settings. Claude availability is independent.
8. Full tests/coverage, targeted mutation, install/docs contracts; machine-readable
   evidence and readable limitations; commit/push only the verified checkpoint.
9. Actual retained Nest application exposed a last-mile defect: file integration
   passed but CLI exited 2 because `recordImplementationLifecycle` rejects `apply`.
   Extend the supported action in `src/core/task-store.mjs`; strengthen the apply
   regression to assert the sealed task event and CLI exit, not just copied bytes.
   Preserve the first warning receipt. Restore only the four task-owned temporary
   project source paths to their exact base (candidate remains in its worktree),
   re-run apply and ordinary verification. No company source or shared refs change.
10. Evidence review found requestMetrics reading `knowledgeDocuments.documents`
    while schema-v2 supplies `paths`. Add a nonzero count assertion to the BTH
    benchmark test and correct the projection. Preserve the originally recorded
    count with a clearly separated request-derived correction; do not rerun a
    model or alter its success/timing to fix this metadata-only counter.

## Boundaries

No production DB, private Bitbucket writes, auth changes, usage-credit resets or
invented external reviews. No claim of OS egress isolation. Raw error bodies may
contain data, so test identity + failure code is the default recovery envelope;
retained public workspaces are explicit audit artifacts, not automatic uploads.

## Verified checkpoint

- Units 1–6, 8–10 completed with failing-first fixtures and final QA. Unit 7's
  actual Nest candidate passed on attempt one: authored tests 2/2, independent
  acceptance 7/7. No real model repair occurred, so that part is unproven.
- The first real apply integrated bytes but exited 2 on the missing lifecycle
  action. After the regression fix, repeat apply exited 0 and persisted its
  event; integrated verification ran 2 tests, then the temporary task reached DONE.
- Final suite: 439 tests, 435 pass, 0 fail, 4 explicit environment skips.
  Coverage line 90.51%, branch 80.61%, function 98.82%; 14 targeted mutations
  killed; syntax and installed-package smoke passed.
- Evidence: `docs/evidence/failure-recovery-v27.md` and `artifacts/v27/`.
- The product goal remains active. Next investigate the real input retrieval
  gap (Recall@5 0, Recall@20 0.5) and finish independent task/Claude coverage.
  Do not replace the 20-task acceptance goal with this one successful case.
