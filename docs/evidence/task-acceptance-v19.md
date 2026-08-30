# Task acceptance oracle v19

Date: 2026-08-31

## Scope and authority

The benchmark can now execute pinned historical regression tests in three
independent temporary snapshots: base, target, and the provider's candidate.
Test source comes from the target commit and is never supplied in the provider
prompt or written into its certified workspace. This is evaluator isolation,
not an operating-system anti-cheating or model-training-contamination guarantee.

The negative control must execute the expected named testcases and reproduce a
failure/error; a compiler exit, missing report, unrelated failing test, skipped
test, duplicate testcase, timeout, or source mutation cannot validate it. The
target must pass every expected testcase with zero reported failures/errors.
Only then can the candidate establish task acceptance. Candidate Git/source
snapshots are checked before/after copying and after evaluation. All working
copies allocated by the evaluator are removed in `finally`.

Normal implementation-and-verification time excludes benchmark-only oracle
time equally for both lanes; oracle elapsed and complete-case elapsed are
separate observations. No extra oracle runs were added to ordinary `bth work`.

## Real Spring controls

Task: `spring-02-owner-search-whitespace`

- Base: `0f6e8614047bd74cf6223b4d8a858d2ed2824f8a`
- Target: `bb37aad8c332264723817d855e8b3b96b7c392bc`
- Oracle definition SHA-256: `007a3fc5feea615a8c0138fe90dc90150fc43a21c45cc372e238fd0b7b692da8`
- Target test source SHA-256: `bf12386be5621935b92a30d8f7334e3a0399e41c9547b174f2f95fef96232358`

The real Maven command was:

```text
./mvnw -q -o -Dtest=OwnerControllerTests#processFindFormIgnoresSurroundingWhitespace+processFindFormWithWhitespaceOnlyLastNameReturnsAllOwners test
```

| Named regression | Base | Target |
| --- | --- | --- |
| `processFindFormIgnoresSurroundingWhitespace` | error | passed |
| `processFindFormWithWhitespaceOnlyLastNameReturnsAllOwners` | error | passed |

Base exited 1 in 12,647 ms; target exited 0 in 11,709 ms. Both source snapshots
remained stable. Full control evaluation took 27,934 ms. No provider was called
for this control validation. Raw logs and XML (which can include machine paths
and environment properties) are not published.

Report digests:

- Base XML: `86b0b8fbbf0a628ad4ea76a6317c23928dba4994897c58666717777bd7fe29b6`
- Target XML: `e5432bf55ed02e0f56c68788588371d98e3bdf24208c32e00ab086b9f1ed17b9`

## Coverage and limits

Only 1 of 20 corpus tasks currently has a configured, control-validated oracle.
Paid execution refuses tasks with no oracle; preflight remains available for
all tasks. A green base suite alone is `readyForProviderComparison`, while
`readyForTaskSuccessComparison` also requires valid regression controls.

Historical test changes exist for nine tasks; eleven need independently authored
behavioral tests rather than textual patch matching. DB and multi-service cases
need safe local fixtures and must not borrow success from this Spring task.
No complete twenty-task success rate or company-readiness claim is made.

## Validation and corrected test race

The first full run and a confirming rerun exposed the same process-runner test
race: a fixture waited 80 ms and assumed its grandchild had emitted output. Under
load the assertion `stdout.bytes > 0` failed. The fixture now receives an IPC
ready message after the first stdout write before its parent exits; cleanup,
nonempty-output, and digest assertions remain intact. Runtime cleanup behavior
was not weakened to make this test pass.

Final syntax/diff checks passed. Full coverage run: 375 tests, 371 pass, 4
environment-dependent skip, 0 fail. Coverage: lines 89.94%, branches 78.51%,
functions 98.60%. All three targeted mutations were killed. Installed-package
smoke passed. Full log: local `/tmp/bth-oracle-v19-coverage.log`.

The oracle tests execute real local child processes, verify correct and wrong
candidates, preserve the caller's dirty/untracked/deleted files, and reject
missing/duplicate/skipped/unrelated reports, malformed XML, source mutation,
timeouts, invalid scope, and symlinks. Separate runner tests prove acceptance is
called before BTH worktree cleanup and evaluator exceptions remain unmeasured.

## Claude availability observation

A high-effort (`deep`) BTH/direct pair was attempted with a $2 per-invocation
cap. Both CLIs exited before editing with zero reported tokens/cost. A bounded
empty-directory diagnostic returned the classified `rate-limited` failure;
authentication and billing flags were false. No settings, credentials, limits,
or credits were changed. Records: local
`/tmp/bth-provider-comparison-claude-oracle-v1/`.

The failed invocations do not establish Claude implementation quality or a
performance comparison. No task oracle ran on a Claude candidate. The functional
attempt also overlapped local QA, so its wall times are not controlled performance
measurements. Claude comparison remains pending service availability.

## First acceptance-confirmed Codex pair

The same whitespace task was executed through both lanes with balanced/medium
effort using the v19 implementation (`de144db`). Both candidates passed the
existing project verification and both hidden regression cases; both source
workspaces remained unchanged by the evaluator. Neither lane required a retry
or recorded a provider-owned validation command.

| Observation | BTH | Direct |
| --- | ---: | ---: |
| Task acceptance | passed | passed |
| Implementation + normal verification | 114,319 ms | 115,435 ms |
| Provider duration | 58,644 ms | 63,075 ms |
| Total tokens | 162,326 | 113,434 |
| Uncached input | 33,944 | 30,177 |
| Cached input | 125,696 | 80,896 |
| Output | 2,686 | 2,361 |
| Pre-write Recall@5 / Recall@20 | 1 / 1 | 0.5 / 1 |
| Pre-write nDCG@20 | 0.6934 | 0.4306 |
| Oracle-only elapsed | 39,915 ms | 38,854 ms |

The two completion times were effectively equal in this observation; BTH used
more total and uncached tokens. No general speed or cost advantage is established.
Cost remains null. This is one historical task on a shared workstation, not an
independent holdout or a repeated statistical experiment. Heavy local QA was not
run concurrently with this pair; only light source inspection and small metadata
contract tests continued. The default provider model was not explicitly pinned.

Candidate source digests:

- BTH: `145b62027a97add449657fe4076987a8c20239a2c22585ee3f92a786ddcc22c3`
- Direct: `7216f1db4c8d97dd08e07a93d45d6a669c437e3f8d3a890a7bf49b4e0ee4ce98`

Candidate regression report digests:

- BTH: `c54e9a6346e77be26aa6a44fd84536228408e6563f25e24f0a4b57d779d357c5`
- Direct: `428db043075e505bbe86a0384f77604e258686810b7352740dd1aa8511d31d70`

Records: local `/tmp/bth-provider-comparison-codex-oracle-v1/`. These records
predate the v20 input-fingerprint fields and must not be resumed or aggregated
as new-format results. Their unchanged task definition and harness source are
explicitly identified above. Remaining corpus tasks still need independent
acceptance definitions and actual execution.
