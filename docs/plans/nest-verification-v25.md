# NestJS execution evidence and strict Jest conversion v25

Previous goal turn made progress: 833ed49 is pushed, with five independently
controlled Spring tasks. The three-backend/twenty-task goal remains unchanged.

## Observed gaps

- Nest file-flow task 07ac5f2 -> f470390 has Jest 29.7 / ts-jest 29.3.4 / TypeScript
  5.8.3, a direct `jest` script, and only separate E2E tests (no src unit specs).
- The source change maps a saved FileEntity back to FileType and replaces map
  with mergeMap so the interceptor emits resolved values, not Promise objects.
- Existing portable test discovery already generates a Jest runner. Do not add
  another framework-detection system. Its JSON converter currently treats unknown
  statuses as passed and does not reconcile aggregate/suite failures. Its raw
  JSON output also needs clearing before execution to exclude stale data.
- Acceptance clones contain no Node dependencies. Preparation must use pinned
  package-lock content and offline/no-lifecycle-script installation in owned
  clones after an explicitly network-enabled cache warmup. Do not run the public
  E2E suite against inherited endpoints or fabricate a passing empty baseline.

## Atomic implementation / verification units

1. Add `src/core/jest-report.mjs`, a standalone embeddable JSON-to-JUnit converter,
   and `test/jest-report.test.mjs`. Validate final known statuses, interruption,
   suite execution errors, required aggregate counts, duplicate identities,
   bounded names/output and XML escaping. Retain skipped/todo as skipped, never
   passed; omit failure-message bodies. Use linear traversal and bounded output.
2. Embed that function in `src/core/portable-test-discovery.mjs` rather than a
   divergent copy; remove stale Jest JSON before spawn, validate file/directory
   boundaries and require a fresh regular bounded result. Add actual generated
   runner tests in `test/init-project.test.mjs`, including unknown status, stale
   raw output, aggregate contradiction, and failed suites. Preserve declared
   test arguments, all required gates and process exit authority.
3. Add evaluator-owned Nest file-flow fixture(s) and an offline runner under
   `benchmarks/public-backend-v1/fixtures/nest/`. Exercise actual TypeScript classes,
   persistence mapping, observable values/errors and null/lookups with mocked
   infrastructure only. Do not claim real DB or S3 behavior. Source/test code
   executes only in temporary public clones; no application bootstrap or env file
   load is needed. Bind all fixture files and the converter by hashes in the
   task acceptance configuration, with tests for config/hash integrity.
   The first live control exposed project-local-only executable resolution.
   Support exactly `node <pinned-test-file>` via the evaluator's process.execPath
   (not PATH); reject flags, extra args and unpinned files. Cover this narrow
   evaluator extension in provider-benchmark-config/task-acceptance tests.
4. Warm the pinned dependencies in an owned clone using `npm ci --ignore-scripts`
   with network explicitly allowed; subsequent acceptance installations are
   offline, no scripts/audit/fund. Run independent base and target controls using
   `evaluateTaskAcceptance`, requiring actual named-case execution, source stability,
   a base regression and target pass. Missing dependencies/compiler failures never
   count. If the empty ordinary Jest baseline prevents public preflight, record
   that gap explicitly; do not insert an artificial passing test or relax final
   candidate gates to make the benchmark green.
5. Add a targeted mutation control for unknown Jest statuses, run focused/full
   coverage, installed-package and document contracts, record real observed
   outcomes/limitations under `docs/evidence/artifacts/v25/`, update README and
   push. Existing generated project runners are not silently overwritten; explain
   regeneration/backups. Continue remaining controls and paid comparisons.

Further tasks such as Nest email updates may reuse the runner only after their
own pinned APIs and behavioral requirements have been read. They are not counted
by this plan's tests. References: Jest 29.7 CLI/config docs, plus actual pinned
package/source and the installed Jest JSON result shape.
