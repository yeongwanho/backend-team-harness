# BTH 0.7 adaptive harness QA

Date: 2026-08-30

## Scope

This evidence covers:

- opt-in adaptive ordering of explicitly reorderable required Gates;
- bounded aggregate history and unsafe/corrupt-history fallback;
- schedule provenance in run records;
- global PageRank in the advisory Java/Kotlin import graph;
- source/run/digest-bound Personalized PageRank context in approved plan export;
- the scoped independent fail-fast expected-feedback benchmark;
- regression of the real JVM and MySQL reference paths.

It does not claim a production-project speedup, a test-selection recall result, or overall superiority to another harness.

## Commands and observations

### Complete local suite

```bash
npm run check
```

Observed after the implementation and algorithm cleanup:

- 135 tests discovered;
- 133 passed;
- 0 failed;
- 2 explicitly skipped because the default suite does not opt into real JVM/MySQL E2E.

The suite includes scheduler mathematics, stable ties, hard segment boundaries, exact Gate identity preservation, corrupt/symlink history, full PASS-path Gate execution, graph contract rejection, source-bound graph loading, context budget, plan-export CLI, state-machine invariants, report freshness, source drift, redaction, locks, and permission gates.

### Focused adaptive/context regression after hard-budget correction

```bash
node --test \
  test/code-context.test.mjs \
  test/harness-v1-cli.test.mjs \
  test/benchmark.test.mjs \
  test/gate-scheduler.test.mjs \
  test/gate-history-store.test.mjs
```

Observed: 19/19 passed, 0 skipped. The budget test checks that `usedCharacters` equals the sum of the serialized returned entries, not merely an internal pre-decoration estimate.

### Real JVM paths

```bash
npm run test:real-jvm
```

Observed: 3/3 passed. This exercised real Maven/JUnit and an isolated cold-cache Gradle Wrapper resolution followed by real JUnit ingestion.

### Real MySQL path

```bash
npm run test:real-db
```

Observed: 1/1 top-level test passed in 121.154 seconds. The scenario exercised pinned `mysql:8.4.11`, Flyway migration, MySQL-specific behavior, and Testcontainers cleanup after success, assertion failure, process failure, and Gate timeout.

### Deterministic adaptive benchmark

```bash
npm run benchmark:adaptive
```

Observed:

```text
configured expected feedback: 1711.98347107438 ms
adaptive expected feedback:    473.8842975206611 ms
speedup:                         3.612661318451343 x
Gate identity preserved:         true
required/adaptive Gate count:    3 / 3
```

The script exits non-zero below `2.0x` or if Gate identity/count changes. The result is an analytical fixture under the recorded independence assumptions, not an end-to-end wall-clock measurement.

### Dependency and diff hygiene

```bash
npm audit --json
git diff --check
```

Observed: 0 vulnerabilities at every severity; no whitespace errors.

## Why this is enough for the implemented claim

- The ordering rule is pure and its expected-cost equation is tested independently of process timing.
- Integration tests prove the selected order is used while a successful verification still runs every Gate once.
- Gate signatures isolate changed command/result contracts from unrelated history.
- Missing/corrupt/symlinked history cannot silently become trusted or change verdict authority, and a source-drifted run is not learned.
- Plan context is accepted only from a successful codegraph observation sealed to the current source and exact report digest.
- Every ranked entry is an existing graph node, every traversed edge has `static-import-resolved` provenance, and the serialized entry budget is exact.
- Existing report, task, lock, permission, real JVM, and real MySQL paths remain green.

## Residual risk

- The `p/c` order assumes eligible Gate failures are independent and order-independent. Teams must keep correlated or stateful Gates fixed.
- Historical estimates may drift; production-project calibration is not yet available.
- The graph is exact only for the imports it resolves. It is not a call graph and cannot see runtime DI, reflection, generated code, or SQL ownership.
- Localization quality has not yet been measured against gold file/region labels.
- Cross-machine adoption, onboarding time, and real-project latency improvements remain roadmap items.
