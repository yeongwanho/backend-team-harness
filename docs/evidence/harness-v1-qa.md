# Harness v1 QA evidence

- Date: 2026-08-30 (Asia/Seoul)
- Branch: `codex/harness-v1`
- Base: `e284dc43fa8f0cf3cf7761f53c92ae2818806ea8`
- Scope: evidence authority, fact-aware interview, answer revision, source rebind,
  canonical plan approval, provider-neutral export, failed-run diagnosis, state
  invariants, and documentation

## Automated gate

Command:

```bash
npm run check
```

Observed:

- syntax check passed;
- 118 tests discovered;
- 116 passed, 0 failed, 2 environment-gated E2E tests skipped;
- the suite includes tamper, source-drift, symlink, permission, concurrency,
  freshness, redaction, bounded replay, and exhaustive task-transition cases.

Why this is enough for the deterministic core: the full repository test suite
exercises every added state transition and CLI command, including failure-first
regressions for the bugs fixed in this change.

## Real JVM gate

Command:

```bash
npm run test:real-jvm
```

Observed: 3/3 passed. A real Maven `verify` run produced accepted JUnit evidence,
and a Gradle Wrapper resolved from an isolated cold cache before producing real
JUnit evidence.

## Real MySQL gate

Command:

```bash
npm run test:real-db
```

Observed: 1/1 passed in 118 seconds against the pinned MySQL 8.4 test path. The
test covers real migrations and MySQL behavior plus cleanup after success,
assertion failure, process failure, and timeout.

## Residual boundary

This evidence does not claim production adoption, remote attestation, deployment
safety, or production database access. A coding-agent execution adapter is still
external to BTH; `task export-plan` intentionally grants neither write authority
nor completion-verdict authority.
