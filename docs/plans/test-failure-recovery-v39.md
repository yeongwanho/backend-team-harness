# v39 — useful, bounded test failure evidence and actual recovery

The previous turn was progress: bc70e43 shipped opt-in formatting and preserved
an actual candidate whose ordinary tests still have two HTML/XML assertion errors.
The full 3-backend / 20-task product goal is unchanged and incomplete.

## Work units

- [x] Trace current JUnit ingestion → compact verification → provider recovery.
  Confirm the actual failed test source and report before selecting a fix.
- [x] Add failing regressions to `test/junit.test.mjs` and
  `test/implementation-verification.test.mjs`: standard exception identity must
  survive, while raw messages, trace bodies, arbitrary company types, commands
  and unrecognized/mismatched diagnostic codes do not. Preserve legacy output
  when no recognized diagnostic exists; test rerun/flaky evidence and bounds.
- [x] Add `src/core/test-failure-diagnostics.mjs`, wire `src/core/junit.mjs` and
  `src/core/implementation-verification.mjs`. Classify only a small explicit
  standard-exception allowlist from structured report attributes; no message
  inference, unbounded stack traces, auto-pass, test weakening or HTML-specific
  hard-coded repair. The model still diagnoses the cause from source.
- [x] Exercise the complete repair request path in an orchestrator fixture:
  real first failing Gate → second attempt receives the bounded exception
  diagnostic → fresh verification. No fabricated implementation run record.
- [x] Replay the preserved v37 candidate into a new disposable public worktree
  with at most two attempts: first is labelled fixture replay, second is a real
  Codex or Claude provider call. Run the configured formatter and real tests;
  independently evaluate final task behavior and inspect the final diff.
  Record provider version/profile/time/tokens/cost and all failed attempts.
  Never count fixture+repair as success@1 or overwrite the historical pair.
  Observed: Codex removed two XML errors but left one assertion failure. A
  subsequent Claude high repair used that exact output and left the same failure.
  Both independent 6-case checks passed, but neither ordinary gate passed.
  The broader substring assertion also remains a test-quality limitation.
- [x] Freeze code before actual QA, run scoped/full coverage, curated mutation,
  install/docs/Windows contract gates once on the final patch where possible.
  Write evidence and update the unchanged corpus gaps.
  Observed: 589 tests / 585 passed / 4 skipped, 40 curated mutations killed,
  installed package smoke passed, 8 Windows contract tests passed on macOS.
  Actual repair source hashes were checked against this final runtime. Goal
  status remains incomplete and no historical success@1/pair is overwritten.

Publication: commit the reviewed patch and evidence on the current task branch,
push that branch, and verify its remote SHA. Publication is not a release or
proof that the 3-backend / 20-task product goal has passed.

## Constraints

No company/production writes, secret/config changes, new providers or subagents.
No heavy concurrent Java runs and no new heavy run below 2 GiB free. Do not remove
retained candidates/shared caches to free disk. Any provider quota/timeout stays
an explicit failure, not a skipped success. Actual Windows, MySQL and second
developer onboarding still need their own evidence.

Exception classification is untrusted diagnostic data, not proof of root cause.
An XML parsing exception can mean malformed actual XML or an incompatible test
assertion; it is not an instruction to replace every XPath assertion.
