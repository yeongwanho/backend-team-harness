# Benchmark acceptance and telemetry v18

The existing benchmark proves a changed candidate passes the existing suite, not
that it satisfies the requested task. Do not use that observation as task
success@1. Preserve it separately as verificationSuccessAt1.

## Edit and verification units

1. `src/providers/model-cli.mjs`, comparison usage consumers, and provider tests:
   normalize Claude cache creation/read/input separately; accept invocation-final
   usage events only; retain unknown components as null. Verify actual CLI JSONL
   fixtures, absent final usage, truncated/non-JSON output, and zero values.
2. `src/evaluation/provider-comparison.mjs` and scoring/runner tests: require an
   independently confirmed task acceptance oracle for success@1; report oracle
   coverage and legacy schema results without silently claiming task success.
3. `src/evaluation/provider-benchmark-config.mjs`, new oracle evaluator and tests:
   define evaluator-owned pinned test paths and named testcases. Run in separate
   temporary snapshots, never change a certified implementation workspace. Base
   must fail the expected regression and target must pass before an oracle is
   valid. A compile failure or missing testcase is not a valid negative control.
4. Benchmark script/runner: run acceptance after source implementation, before
   BTH workspace cleanup. Record structured controls, testcase outcomes, source
   digests, and elapsed time separately from the normal implementation workflow.
5. Add one real Spring whitespace regression oracle first. Validate base/target
   controls without a paid model call, then run paired providers. Other tasks
   remain explicitly unmeasured until their independent acceptance is defined.
6. Update README and evidence with exact metrics and missing coverage. Run syntax,
   full coverage, mutation, installed-package smoke, and diff checks before push.
7. Full-suite rerun reproduced a race in `test/process-runner.test.mjs`: the
   fixture assumed a grandchild wrote output within 80 ms. Replace elapsed-time
   guessing with an IPC ready message sent after the first stdout write, then
   rerun the process tests and full suite. Do not weaken cleanup assertions.
8. Source audit found `spring-04-future-visit` described the opposite behavior
   from its pinned target. Correct the requirement, retract the old aggregate
   as a current-corpus result, and bind corpus/requirement/config bytes by SHA-256
   in future records so task-text changes cannot silently share a result identity.

No outcome may be reported as general superiority from a single paired task.
Benchmark-only acceptance checks do not add repeated Gates to user CRUD work.
