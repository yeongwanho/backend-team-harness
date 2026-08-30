# Project intelligence and optimized execution 0.9 — QA evidence

**Date:** 2026-08-30

**Base revision:** `404de1799fb0c3f84d4f4b5376ab13192aafbaf7`
**Scope:** deterministic project rules, bounded repository intelligence, semantic impact graph, Gate DAG scheduling, opt-in parallel verification, isolated implementation, bounded recovery, CLI and documentation

## What was tested

The release was checked at four boundaries:

1. strict parser and state-machine tests for unknown/conflict facts, rule blockers, interview finalization, dependency scheduling, write/network denial, diff budgets, and repair limits;
2. graph tests for multiple declarations, edge provenance, duplicate ambiguity, directional reachability, weighted Personalized PageRank, and iterative SCC traversal on 12,000 nodes;
3. actual detached Git worktrees where a project-owned adapter changed source, violated policy, attempted verification-control changes, recovered within a fixed attempt budget, and left the original worktree unchanged; and
4. real Maven, Gradle Wrapper, Flyway, JDBC, Testcontainers, and pinned MySQL 8.4 execution.

## Verification results

### Complete deterministic gate

```text
npm run check
tests 197
pass 195
fail 0
skipped 2
```

The two skips are the environment-gated real JVM and real database tests. They were run separately below.

### Focused configuration and provenance hardening gate

```text
node --test test/implementation-config.test.mjs test/implementation-orchestrator.test.mjs test/project-rules.test.mjs
tests 14
pass 14
fail 0
```

This covers strict implementation configuration, project-owned executable resolution, detached implementation and recovery, and rejection of invented or symlinked policy provenance. The complete gate also includes the regression where one parallel Gate throws while a sibling is still active; verification waits for the full batch before releasing the project lock.

### Real JVM execution

```text
npm run test:real-jvm
tests 3
pass 3
fail 0
duration 24.4 s
```

Observed behavior: real Maven `verify` produced accepted JUnit evidence, and a Gradle Wrapper resolved from an isolated cold cache before producing accepted JUnit evidence.

### Real MySQL 8.4 execution

```text
npm run test:real-db
tests 1
pass 1
fail 0
duration 132.9 s
```

Observed behavior: the DB Pack applied real Flyway migrations to the pinned MySQL 8.4 fixture and exercised MySQL-specific schema behavior plus JDBC reads/writes. The suite also verifies cleanup after success and adverse test-process outcomes. A post-run query found no remaining Testcontainers-labeled containers.

### Packaging, dependencies, CLI, and analytical checks

```text
npm audit --omit=dev --json
vulnerabilities 0

npm pack --dry-run --json
backend-team-harness@0.9.0
entryCount 120

npm run benchmark:adaptive
configuredExpectedFeedbackMs 1711.98347107438
adaptiveExpectedFeedbackMs 473.8842975206611
speedup 3.612661318451343
identityPreserved true

node src/cli.mjs --version
0.9.0

node src/cli.mjs doctor examples/spring-service --json
healthy true

git diff --check
exit 0
```

The scheduler result is a deterministic analytical fixture under the documented independent fail-fast assumptions. It is not a production speed claim and does not compare BTH with OMO.

The package inspection includes `TECH_DEBT_AUDIT.md` and no `.backend-harness/local/` execution workspace or generated run artifact.

## Why the result is credible

- Project understanding is evidence-carrying and three-valued; missing or conflicting facts cannot become confirmed facts.
- Semantic graph output is explicitly advisory and cannot create PASS or skip tests.
- Gate optimization can reorder only ready, opted-in required Gates and preserves every Gate on a successful path.
- Parallel execution is disabled by default and requires explicit independent resource classes.
- Source-writing runs only after a source-bound human-approved plan, fresh write approval, clean source, and project-owned adapter configuration.
- Implementation occurs in a detached worktree with path, file-count, diff-byte, protected-control, timeout, network, and attempt bounds.
- An isolated success is still not merged, committed, deployed, or promoted to `VERIFIED`; the integrated source must pass normal BTH verification.

## Remaining limits

- Java/Kotlin inspection is a bounded source-pattern index, not a compiler call graph, Spring runtime wiring proof, SQL lineage engine, or runtime trace.
- The implementation worktree and approval flags are safety boundaries, not an operating-system sandbox for a malicious project executable.
- Repeated inspection does not yet use a measured incremental parse cache.
- Impact localization does not yet have a versioned gold fixture proving Recall@20 >= 0.85.
- The 0.9 feature set has not yet been validated by a second independently maintained backend team or on Windows CI.
- Cooperative SHA-256 seals detect accidental or unreviewed alteration; hostile-author attestation still requires a separately trusted CI signer.
