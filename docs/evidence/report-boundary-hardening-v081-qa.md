# Report boundary hardening 0.8.1 — QA evidence

**Date:** 2026-08-30

**Scope:** report-path containment, aggregate report memory, code-context metadata bounds, Pack serialization

## Failing-first observations

Before the patch, focused tests reproduced seven failures: final report symlinks and symlink directories were accepted, JUnit/findings had no aggregate byte limit, code-context authority metadata could exceed a tiny entry budget by hundreds of kilobytes, codegraph output was pretty-printed without a producer-side loader limit, and its writer followed a final-file symlink into an external victim.

## Implemented controls

- dedicated report trees reject symbolic links before command execution or collection;
- JUnit and findings use a 16 MiB file limit, 64 MiB aggregate limit, and sequential parsing;
- code-context authority lists accept at most 16 bounded identifiers each;
- codegraph and Gitleaks validate their resolved output directory, emit compact bounded JSON, and atomically replace a final output without following its symlink;
- Pack installation and source binding include the new writer helpers.

## Verification results

### Focused reproduced boundaries

```text
node --test test/packs.test.mjs test/code-context.test.mjs test/junit.test.mjs test/findings.test.mjs
tests 33
pass 33
fail 0
```

The Pack tests execute the installed scripts, preserve byte-identical outside victim files behind final-output symlinks, reject a report-directory symlink before creating anything outside the project, and reject graph serialization above a deliberately small test limit.

### Full deterministic gate

```text
npm run check
tests 168
pass 166
fail 0
skipped 2
```

The two environment-gated real suites were executed separately:

```text
npm run test:real-jvm
tests 3
pass 3
fail 0

npm run test:real-db
tests 1
pass 1
fail 0
duration 134.9 s
```

The JVM suite exercised real Maven and an isolated cold Gradle Wrapper. The database suite exercised the pinned MySQL 8.4 path, migrations, MySQL-specific JDBC behavior, and cleanup after success, failure, abrupt termination, and timeout. A post-run Docker query returned no Testcontainers-labeled containers.

### Package and analytical checks

```text
npm audit --omit=dev
found 0 vulnerabilities

npm pack --dry-run --json
backend-team-harness@0.8.1
entryCount 107

npm run benchmark:adaptive
speedup 3.612661318451343
identityPreserved true
requiredGateCount 3
adaptiveGateCount 3

node src/cli.mjs --version
0.8.1

node src/cli.mjs doctor examples/spring-service --json
healthy true

git diff --check
exit 0
```

The package manifest includes both new Pack writer helpers and the shared report-limit module. The benchmark remains a scoped analytical fail-fast fixture, not a production-speed claim.

## Remaining limit

The existing bounded PageRank loop may report `converged: false` at its 30-iteration cap. That is visible and did not change observed top-result stability in the review probes, but a future algorithm change still requires a maintained localization-quality benchmark.
