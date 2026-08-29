# Roadmap

A checkbox counts only when a real CLI path and acceptance test exist.

## 0.3 — Reproducible verification runner

- [x] Git commit, diff, and untracked-content source binding
- [x] project-declared executable gate schema
- [x] safe project-contained command resolution
- [x] required-gate fail-fast execution
- [x] Gradle `--rerun-tasks` default
- [x] Maven `verify` plus Surefire/Failsafe defaults
- [x] fresh JUnit report discovery and parsing
- [x] zero-test, stale-report, timeout, signal, failure, and error rejection
- [x] descendant cleanup on POSIX timeout
- [x] one-command `bth check`
- [x] local and task-scoped run records
- [x] post-verification source staleness rejection before `DONE`
- [x] non-Java real test-runner acceptance case

## 0.4 — Adoption proof

- [ ] run against two independently maintained backend repositories
- [ ] prove onboarding in 30 minutes or less
- [x] add an opt-in actual Maven + JUnit acceptance fixture
- [x] add an opt-in actual Gradle + JUnit acceptance fixture
- [ ] record cross-machine verdict agreement without requiring identical timestamps or log hashes
- [ ] compare direct local execution time with `bth check` overhead
- [ ] document flaky-test and retry policy without converting a flaky failure into PASS

## 0.5 — DB recipes

- [ ] Testcontainers migration + integration-test recipe
- [ ] Docker Compose migration + integration-test recipe
- [ ] explicit teardown and orphan-resource acceptance test
- [ ] optional managed PostgreSQL Pack only if real projects lack their own lifecycle
- [ ] secret scan before exporting a task run record

## Later, only with measured demand

- [ ] observed coverage-to-test index
- [ ] observed SQL/table relationship index
- [ ] conservative changed-test recommendations with full-test fallback
- [ ] CI adapter that reuses the same `verification.json`
- [ ] provider-neutral AI explanation of existing run records

## Explicitly deferred

- guessed full Spring call graph
- Neo4j or a graph service
- LLM-generated PASS decisions
- automatic deployment or production DB access
- CI replacement, multi-agent runtime, CRDT task store, or SaaS dashboard

Model integration remains optional and last. A model may explain a run; it may not replace source binding, command execution, JUnit counts, or the verdict contract.
