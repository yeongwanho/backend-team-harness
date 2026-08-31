# v40 — new backend task rather than another saved Java repair

The preceding goal turn made progress: b188df3 shipped bounded JUnit failure
diagnostics and recorded two real but unsuccessful repairs. The full objective
remains three independent backends / twenty versioned tasks with fair provider
baselines; it is not complete.

## Work units

- [x] Inspect the existing corpus/runner and pinned FastAPI authentication task.
  Its nine-case behavioral oracle exists, but the ordinary project suite has no
  declared local evaluation environment. Read the original tests and compare the
  older missing-user task fixture. The newer pre-start tests are already fixed;
  do not overwrite them with the older fixture.
- [x] Add a failing config contract test in `test/provider-benchmark-config.test.mjs`
  requiring a source-hashed, test-environment-only fixture for
  `fastapi-04-constant-time-login`. Production code and task assertions must not
  be supplied. Preserve its acceptance oracle. No replacement of its already
  corrected pre-start tests.
- [x] Extend `benchmarks/public-backend-v1/provider-comparison.json` for that task
  using the existing full-suite public Postgres/mail isolation fixture minus the
  two unnecessary pre-start replacements. Synthetic email helper replacement is
  hash-bound. Run the real prepared baseline, determine its test floor, and verify
  the independent base fails / target passes before any model invocation.
  Observed: original suite plus two environment-contract tests executes 62/62;
  set the final minimum to 62. The nine-case independent oracle reproduces the
  base regression and passes the target. No original API/pre-start assertions
  were replaced in this task's common environment.
- [x] Freeze relevant source/config/fixture hashes. Execute real BTH/direct cases
  sequentially with one provider call per lane, identical provider/model/profile
  within a pair, isolated public workspaces and retained failure evidence.
  Try Codex and Claude high pairs if preparation/disk permit; a preparation or
  provider failure is recorded, never called a passed task or silent skip.
- [x] Check source changes and tests, record inference/verification/acceptance,
  source-bound rule and impact metrics, elapsed time, tokens and reported cost.
  Keep controlled editing baseline distinct from native full-workflow baseline.
- [x] Run scoped config/fixture/comparison tests, final syntax/docs checks, rebuild
  the corpus ledger without rewriting historical results, document remaining
  goal gaps. Observed: 52 scoped tests and 10 final config/docs tests pass;
  ledger has 9 historical paired tasks, 4 historically successful paired tasks,
  11 configured and 10 current validated oracles. No completion claim from one
  extra task. Delivery: commit/push reviewed evidence and verify the remote SHA;
  publication status is recorded by the task's final response.

## Constraints

Use only disposable copies of the existing public mirror and the existing pinned
database image, synthetic data, and owned temporary containers. No company or
production writes, user config changes, additional providers or subagents. Do
not delete retained candidates/shared caches. Disk started at about 1.7 GiB free;
do not start heavy JVM builds or a new image pull. If constrained, finish safe
code/evidence work and keep the exact task gaps visible.

The authentication oracle observes password-verification work and public API
responses. It does not prove constant-time behavior or absence of timing leaks.
Postgres is the upstream FastAPI project's test dependency, not a change to the
product's MySQL-first priority.
