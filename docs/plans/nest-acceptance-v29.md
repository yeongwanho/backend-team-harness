# Independent acceptance expansion v29

Previous turn: verified progress, checkpoint 7c96c03 pushed. The full three
backend / twenty task / paired Codex-and-Claude goal stays active.

## Evidence and scope

Only six configured tasks currently have independent base-fails/target-passes
controls: five Spring tasks and Nest file mapping. Ranking improvements do not
close this gap. Inspect `evaluateTaskAcceptance` -> pinned fixture injection in
separate evaluator clones -> exact generated Jest runner -> named JUnit cases.
No hidden fixture or target revision may enter the provider workspace.

This patch adds Nest session conditional refresh, Swagger language header and
email-conflict behavior. These are real public source executions with mocked
persistence/external boundaries, not real DB concurrency or HTTP deployment.
No company source, production service, credential or authentication config is
in scope. Keep current pins and requirements; do not substitute easier tasks.

## Atomic work and evidence

1. Read each pinned base/target call path and map requirement clauses to cases.
   Record uncovered requirements in other tasks. In particular Nest document
   generators throw `Record not found` on an absent pre-read, while user/session
   repositories return null; do not hide this by claiming uniform null behavior.
2. Add `fixtures/nest/users-email.spec.ts`: unused email, own email, conflicting
   email, no-email updates, unchanged payload, error propagation and no write
   on rejection. Actual UsersService; mock repository/files only.
3. Add `fixtures/nest/swagger-language.spec.ts`: configured/default/empty header,
   optional English example in the generated Swagger operation. Execute real
   bootstrap with a synthetic Nest module, forbid env loading and listening;
   close each app. Prefer actual DocumentBuilder/Swagger rather than a regex.
4. Add `fixtures/nest/session-hash.spec.ts`: abstraction delegation, matching
   ID+hash in both adapters, no-match/null/error behavior, auth conditional
   update before signing, stale/absent refusal and signed rotated hash. Dynamic
   interface checks let the base compile; a missing method must fail an executed
   assertion, not be counted as a compiler/setup failure.
5. Add three exact-file Jest configs reusing existing options/runner, leaving
   file-flow behavior unchanged. Add each pinned fixture/case list to
   `provider-comparison.json`; extend config tests for cases, exact fixture pins,
   and no answer/fixture leakage into decisions. Run failing-first config test.
6. Run actual controls for each new task and the existing Nest task. Dependencies
   come from reviewed public lockfiles with lifecycle scripts disabled; controls
   install offline. If the cache is missing, prepare only disposable public
   clones and retry the same task. Setup errors never count as regressions.
7. Add a reproducible model-free control command if needed, with mirror origin,
   full base/target pins, output non-overwrite and per-task failure recording.
   Record exact source/config/fixture digests and report/case outcomes. Do not
   label mocks as DB atomicity evidence or claim provider improvement.
8. After controls, inspect real provider preflight for a newly enabled task and
   run a bounded paired comparison where provider access and setup are ready.
   Do not change auth or consume reset credits. Preserve failure results.
9. Run full QA, fixture pin checks, targeted mutation/install/doc contracts,
   write reviewed evidence including omissions, and push a verified checkpoint.
   A partial checkpoint does not complete the twenty-task objective.

## Actual provider finding and bounded follow-up

The first fixed-model Codex pair completed source edits but both lanes changed
`test/admin/users.e2e-spec.ts`, outside the default Jest `rootDir: src` and
`testRegex: .*\\.spec\\.ts$`. Both final gates executed zero tests. Preserve both
failures; do not relax the minimum or silently select the E2E suite.

10. Add `src/core/test-authoring-contract.mjs`, a bounded read-only descriptor
    for an exactly recognized generated Jest gate. Read only declared build
    inputs, compare config and generated runner bytes, cite hashes, and expose
    only inline discovery fields. Custom commands, external/dynamic config,
    presets/projects, ambiguous inputs, symlinks and invalid data stay unknown.
    No full repository scan, config execution, new dependency or test run.
11. Attach that descriptor once before provider attempts in
    `implementation-orchestrator.mjs`; direct the provider to use it before
    copying an adjacent test. Preserve schema-v1, all gates, write/approval
    boundaries, and the existing source binding. Add failing-first unit and
    full-workflow assertions, including metadata exclusions and stale runner.
12. Replay the public source metadata without a model, then make a fresh bounded
    one-attempt BTH run on the same task/model/mode. Keep initial paired results
    distinct: a follow-up is diagnostic, not a replacement success@1 sample or
    a statistically established speedup. Record any failure and remaining scope.
    Version the provider benchmark protocol as `test-authoring-v29` so older
    requests cannot be silently resumed into the changed protocol. Add targeted
    mutations for stale runner and custom-gate rejection, then full regression,
    coverage, package install and documentation/evidence checks.

## Checkpoint outcome

- Email and Swagger controls confirmed; existing mapper controls retained.
  Session controls remain unconfirmed because both pinned revisions fail npm ci.
- Initial Codex pair: both failed (E2E tests outside the default test scope).
- Bound test-authoring scope implemented and observed from actual source.
  Follow-up wrote the right test path but failed TS2353 before any test ran.
  Preserve that failure and the owned candidate; do not call it task completion.
- Local suite: 458 total, 454 passed, 0 failed, 4 environment skips; line
  coverage 90.56%, branches 80.89%, functions 98.83%. All 18 selected mutations
  caught by assertion failure; packed 0.9.0 CLI installation check passed.
- Next runtime priority: safe compiler diagnostic code/location propagation.
  Current recovery keeps junit_reports_missing, losing TS2353 and its location.
  Remaining acceptance tasks, pinned session environment and full paired
  Codex/Claude matrix still belong to the active goal.
