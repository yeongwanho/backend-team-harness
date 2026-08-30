# Acceptance expansion and validation integrity v21

2026-08-31 checkpoint. This does **not** complete the 3-repository/20-task product
goal and adds no paid implementation result. It makes two more real regressions
measurable and fixes defects found while exercising real failed tests.

## Observable product correction

Spring MockMvc prints rendered HTML inside JUnit `system-out` CDATA on failure.
The parser previously rejected any `DOCTYPE` text, including that inert HTML.
A real six-test visit regression ran with four assertion failures but was reported
as unreadable XML. The same target ran with all six tests passing.

`src/core/junit.mjs` now scans declaration positions while skipping CDATA,
comments and processing instructions. Actual DTD/ENTITY declarations are still
rejected; entity expansion remains disabled; malformed/unclosed XML still fails.
The scan advances monotonically across the bounded input. Tiny synthetic tests
failed before the correction and passed after it, including an active external
declaration placed after inert markup. No external entity is fetched.

## Independent regression controls

Fixture-backed tests are now supported in addition to target-owned tests.
The config binds fixture content by SHA-256; the evaluator rejects changed bytes,
traversal, symlinks, oversized sources and overwrites of non-test source, Git/harness
metadata or dependencies. Tests run only in separate base/target/candidate clones,
not the provider's workspace. Unit tests prove a candidate can still fail after
the controls pass and that the original candidate remains untouched.

| Task | Base | Target | Outcome |
|---|---|---|---|
| `spring-01-pet-association` | 3 of 4 named checks fail; valid-name check passes | 4/4 named checks pass | Controls confirmed; 24.117 s |
| `spring-04-future-visit` | 4 of 6 checks fail; future acceptance and required description pass | 6/6 pass | Controls confirmed; 30.332 s |

All source-stability checks passed. No compiler error, missing/skipped/duplicate
testcase, timeout or mutable source was used as successful regression evidence.
The earlier whitespace task makes **3 configured, control-verified tasks out of
20**. Only the whitespace task has an earlier acceptance-confirmed Codex pair.

For Spring 01 the actual direct evaluator invocation used the task/config entries
from `benchmarks/public-backend-v1`, the complete mirror
`/tmp/bth-provider-comparison-cache-v2/spring-petclinic.git`, and a 120000 ms bound.
The final Spring 04 command exercised dependency setup, normal base verification
and both regression controls through the public benchmark entrypoint:

```sh
node scripts/benchmark-provider-comparison.mjs --preflight \
  --task spring-04-future-visit \
  --output /tmp/bth-provider-preflight-v21-final \
  --cache /tmp/bth-provider-comparison-cache-v2 \
  --timeout-ms 300000 --allow-network
```

Its normal base verification passed 60/60 tests; total preflight elapsed was
135500 ms including setup and controls. This is evaluator preparation time, not
an implementation benchmark or a cost imposed on ordinary CRUD work. Reproduction
needs a fresh output directory. `--allow-network` permits dependency fetching;
it does not claim OS-level network isolation.

Persistent, structured evidence: [acceptance-controls.json](artifacts/v21/acceptance-controls.json)
(SHA-256 `43c58b9fd988bffa0597e86833fe0a0ff46e2593d099d8ed3ee779d9fe3e23c9`).
It contains exact corpus/config/fixture hashes, base/target pins, testcase outcomes,
source-stability results and report/output digests. It contains no raw rendered
HTML, environment dump, credentials, company source or model transcript.

Initial attempts are not counted as passes: an extra nested-class report path
did not exist; an older Spring parent was missing from the offline Maven cache;
a concurrently formatted fixture invalidated its pinned hash; and the real base
failure exposed the CDATA parsing bug. The final controls above are fresh reruns.

## Retraction and repair of earlier mutation evidence

The old smoke script treated any nonzero exit as a killed mutant and omitted
`test-support` from its copy. Adding an unmutated baseline reproduced
`ERR_MODULE_NOT_FOUND` in `generic-verification.test.mjs` **before mutation**.
Therefore prior "3/3 killed" output was not adequate evidence of three effective
tests. That claim is superseded by this baseline-controlled run.

The script now copies runtime/test dependencies, requires an executed passing
baseline, and requires non-signalled assertion evidence with matching test and
skip counts after mutation. Missing modules, timeouts and crashes cannot count
as a kill. Five targeted mutants are checked: transition authority, process
verdict, draft blocker, active DTD rejection, and inert-HTML acceptance. This is
still targeted mutation smoke, not repository-wide mutation coverage.

| Mutation test | Unmutated passing tests | Mutant failing tests |
|---|---:|---:|
| task-state | 8 | 1 |
| generic-verification | 11 | 6 |
| work-draft | 4 | 2 |
| junit: declaration rejection removed | 14 | 2 |
| junit: inert DOCTYPE over-rejected | 14 | 1 |

The provider-refusal CLI test also incorrectly depended on a real task staying
unconfigured. Adding its oracle started clone/dependency preparation during a test.
The owned benchmark process and its Maven process group were stopped during setup,
before provider execution. No paid model result was produced. It now constructs
its own oracle-free config, uses an empty executable search path and a timeout;
real corpus changes cannot silently enable a paid test call.

## QA and remaining work

Commands: syntax check; focused JUnit/acceptance/config/script tests; full coverage;
baseline-controlled mutation smoke; installed-package smoke; `git diff --check`.
Full suite: **382 tests, 378 passed, 0 failed, 4 environment-gated skips**.
Coverage: lines **89.98%**, branches **78.77%**, functions **98.60%**.
Five mutants killed with passing baselines; installed package 0.9.0 smoke passed.
After a final test-only readability edit, JUnit's 14 tests were rerun successfully.

Default-suite skips remain real MySQL/JVM opt-in and two actual-Windows cases.
The separate real Spring runs above prove their scoped JVM behavior only.
No real Windows or company DB coverage is implied. No new Claude invocation was
attempted; its earlier rate limit is not a quality score.

The [20-task source audit](corpus-behavior-audit-v21.md) records remaining acceptance,
safe service setup and historical-target limitations. Corrected static localization
is Recall@20 0.619048, with the Swagger entrypoint at rank 39. This checkpoint
does not prove faster implementation, lower tokens, production readiness or
superiority to direct Codex/Claude. Seventeen oracles and the full paired execution
matrix remain; retrieval quality and task-specific service isolation need work.
