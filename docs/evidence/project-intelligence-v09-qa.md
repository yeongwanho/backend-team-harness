# Project intelligence and optimized execution 0.9 — QA evidence

**Date:** 2026-08-30

**Base revision:** `aae3f1018ba3f51e6bc0ba06625a4601ce99bf09`
**Scope:** deterministic project rules, bounded repository intelligence, semantic impact graph, exact/heuristic Gate DAG scheduling, opt-in parallel verification, isolated implementation/integration/reset lifecycle, bounded recovery, CLI, and documentation

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
tests 227
pass 225
fail 0
skipped 2
```

The two skips are the environment-gated real JVM and real database tests. They were run separately below.

### Focused adversarial hardening gates

```text
node --test test/implementation-orchestrator.test.mjs
tests 24
pass 24
fail 0

node --test --test-name-pattern='rename detection|original-source|Kotlin modifier' \
  test/implementation-orchestrator.test.mjs test/semantic-graph.test.mjs
tests 3
pass 3
fail 0
```

These cover detached implementation and recovery, exact integration inventory, plan-edit reset recovery, hostile inherited Git environment, shared refs/index flags, Gate mutation, large rename byte-budget bypass, original-source escape evidence, and Kotlin supertype classification. The complete gate also includes strict configuration/provenance and the regression where one parallel Gate throws while a sibling is still active; verification waits for the full batch before releasing the project lock.

### Clean Git configuration portability regression

The first pushed CI run exposed that the implementation fixture depended on the maintainer machine's `commit.allowEmpty=true`. The fixture was changed to force-add its isolation `.gitignore` files before the first commit, rather than creating a redundant second commit. The corrected setup was rerun without a global Git configuration:

```text
GIT_CONFIG_GLOBAL=/dev/null node --test test/implementation-orchestrator.test.mjs
tests 24
pass 24
fail 0
```

This proves the detached-worktree fixture carries its ignore contract from the initial commit and no longer relies on maintainer-specific Git settings.

### Real JVM execution

```text
npm run test:real-jvm
tests 3
pass 3
fail 0
duration 31.2 s
```

Observed behavior: real Maven `verify` produced accepted JUnit evidence, and a Gradle Wrapper resolved from an isolated cold cache before producing accepted JUnit evidence.

### Real MySQL 8.4 execution

```text
npm run test:real-db
tests 1
pass 1
fail 0
duration 131.0 s
```

Observed behavior: the DB Pack applied real Flyway migrations to the pinned MySQL 8.4 fixture and exercised MySQL-specific schema behavior plus JDBC reads/writes. The suite also verifies cleanup after success and adverse test-process outcomes. A post-run query found no remaining Testcontainers-labeled containers.

### Packaging, dependencies, CLI, and analytical checks

```text
npm audit --omit=dev --json
vulnerabilities 0

npm pack --dry-run --json
backend-team-harness@0.9.0
entryCount 121

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

### Independent review response

- Claude Opus/high previously identified stale CLI fields, unsafe shared temporary workspace assumptions, post-Gate evidence ambiguity, missing reset/cleanup authority, hidden Git index/ref paths, Flyway coverage, and documentation overclaims. Those findings were checked against code and addressed. A final fresh Claude run on this revision was attempted but rejected by Claude's account session limit; it is not counted as completed review evidence.
- Grok 4.6/xhigh independently read the 26-file delta and surrounding code. Its release-blocking large-rename diff-budget finding was reproduced and fixed with a `--no-renames` byte diff plus a 128 KiB regression. Its overall/attempt outcome inconsistency and Kotlin interface-edge finding were also fixed and tested.
- Grok's proposal to namespace duplicate Flyway versions by nested directory was rejected after checking Flyway's current official contract: one location is scanned recursively and each versioned migration in a run must have a unique version. A regression now proves that a nested directory does not silently invent a namespace. Separately configured Flyway locations remain a future configuration-aware enhancement rather than an inferred exception.

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
