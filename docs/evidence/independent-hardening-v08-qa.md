# Independent hardening 0.8 — QA evidence

**Date:** 2026-08-30

**Base revision:** `ac5a9d44fd18559a9d0569864f18af789c82d519`
**Scope:** source binding, process cleanup, report ownership, portable evidence, locking, optimizer telemetry, Packs, planning output, redaction, documentation

## Review method

Claude Opus (high effort) and Grok 4.6 (high effort) reviewed the repository independently. Their outputs were treated as untrusted hypotheses. A finding entered the patch only after the source demonstrated it or a failing regression test reproduced it.

The completed Claude review was source-only. A second Claude pass over the final diff was attempted but the provider session quota was exhausted, so it is not represented as a completed review. Grok then reviewed a disposable final repository snapshot and returned concrete source-level findings. Its snapshot was intentionally not allowed to supply product verdicts; all verdicts below come from commands run in the maintained working tree.

## Failing-first observations

The initial regression probes demonstrated these defects before their fixes:

- a successful direct process could be reported as a command timeout when a descendant retained stdout;
- source identity for a nested backend changed after a sibling-only commit;
- untracked/declared source hashing had no explicit per-file or aggregate bound;
- two Gates could claim the same structured report output;
- an old valid JUnit file could be made fresh by changing only metadata;
- a committed sealed run summary was unusable for final handoff on another clone;
- the portable summary path was not narrowly separated from local verification evidence;
- baseline updates did not validate the latest-run seal;
- a recycled PID could retain a stale lock, while a foreign-host PID could be misread as local; a later final-diff review also separated stable host identity from per-boot process identity so same-host reboot remnants remain recoverable;
- credential names delimited by underscores were not consistently redacted;
- Docker proxy, context, image-prefix, and rootless routing were missing, while an ambient Ryuk-disable flag could pass through;
- bounded optimizer history stopped learning when full;
- PageRank output did not say whether tolerance was reached;
- executable Packs reused report directories and the Gradle architecture task was not copyable from the Pack;
- exported plan Markdown did not show its human review checklists;
- diagnosis omitted required Gates skipped after an earlier required failure;
- 0.7 approved or verified tasks could not cross the 0.8 source-fingerprint format change even when their source was unchanged;
- project-root report globs could select unrelated XML, while tracked or non-ignored matches could be deleted before execution;
- stdout/stderr digest finalization could race late descendant output, and cleanup did not guarantee listener detachment on every drain path;
- a source file could grow past its bound after the initial metadata check;
- architecture Pack tests could run in both the default test task and their dedicated Gate;
- approved-plan graph reads were not serialized with verification report regeneration;
- the ambient Testcontainers reuse flag was not removed; and
- Pack lookup accepted inherited `Object` properties instead of only catalog entries.

One source-symlink-policy simplification caused an existing safety test to fail. It was reverted; the intended command-symlink behavior remains source-bound and is still rejected before execution by the Gate resolver.

## Accepted and rejected review claims

Accepted findings are covered by regression tests for report purge/ownership, 0.7 fingerprint migration, portable evidence scope, foreign-host and PID-reuse locks, waited descendant cleanup and digest stability, environment filtering, redaction, bounded hashing/history, Pack isolation, plan export locking/output, and diagnosis completeness.

The claim that query-aware PageRank could never converge was rejected after direct counterexamples. A symmetric two-node cycle reaches an exact fixed point in one iteration, while path/star fixtures correctly report iteration-cap non-convergence. The algorithm was therefore instrumented rather than replaced without a gold localization benchmark.

Cooperative SHA-256 seals were not upgraded in language to security attestation. Protection against an author who controls both source and records requires a separately trusted CI signature/attestation policy and remains future work.

## Verification results

### Full deterministic gate

```text
npm run check
tests 160
pass 158
fail 0
skipped 2
```

The two skips are the environment-gated real JVM and real database suites, run separately below.

### Focused post-review regression gate

```text
node --test test/process-runner.test.mjs test/verify-task.test.mjs test/packs.test.mjs test/project-lock.test.mjs test/interview-orchestrator.test.mjs test/generic-verification.test.mjs test/verification-config.test.mjs test/record-safety.test.mjs test/source-binding.test.mjs test/code-context.test.mjs
tests 66
pass 66
fail 0
```

The CLI diagnosis test was also rerun after adding skipped-Gate coverage: 5/5 passed.

After the final Grok review, the focused process/report/source/export/Pack migration gate was rerun:

```text
tests 56
pass 56
fail 0
```

### Real JVM execution

```text
npm run test:real-jvm
tests 3
pass 3
fail 0
duration 26.2 s
```

Observed behavior: Maven `verify` produced accepted JUnit evidence, and Gradle Wrapper resolved from an isolated cold cache before producing accepted JUnit evidence.

### Real MySQL 8.4 execution

```text
npm run test:real-db
tests 1
pass 1
fail 0
duration 115.5 s
```

Observed behavior: the pinned MySQL 8.4 Testcontainers path ran Flyway migration, MySQL-specific schema behavior, and JDBC reads/writes. The suite also exercised successful, failed, abruptly terminated, and timed-out test processes. A post-run Docker query for Testcontainers-labeled containers returned no rows.

### Packaging, dependency, CLI, and analytical checks

```text
npm run benchmark:adaptive
speedup 3.612661318451343
identityPreserved true
requiredGateCount 3
adaptiveGateCount 3

npm audit --omit=dev
found 0 vulnerabilities

npm pack --dry-run --json
backend-team-harness@0.8.0
entryCount 102

node src/cli.mjs --version
0.8.0

node src/cli.mjs doctor examples/spring-service --json
healthy true

git diff --check
exit 0
```

The scheduler number is an analytical independent-failure fixture, not a claim of production speedup.

## Why this is enough

The checks cover the modified verdict boundaries at three levels: isolated failing-first invariants, the complete deterministic suite, and real Maven/Gradle/MySQL execution. The real database path proves that the stricter report cleanup and environment allowlist still permit the maintained Testcontainers lifecycle. Source-drift, permission, process, report, test-count, and portable-handoff failures all remain fail-closed.

## Remaining limits

- Windows `.cmd`/`.bat` execution and descendant cleanup need a real Windows CI gate before being claimed as supported behavior.
- Cross-host locks are deliberately conservative; this release does not add a manual unlock command. On hosts without Linux boot/process-start identity, ownership falls back to platform plus hostname and PID, so a shared volume requires unique hostnames or operator removal of an abandoned foreign-host lock.
- Cooperative seals detect accidental/unreviewed alteration but are not hostile-author attestation.
- The code graph is a bounded Java/Kotlin import graph, not a compiler call graph, runtime trace, or test-selection oracle.
- The adaptive `3.61x` result is a mathematical fixture; production latency and correlation still need measurements from independently maintained backends.
- Architecture/contract/database Packs remain project-owned recipes. Their commands fail closed until the project supplies the real tests and lifecycle.
