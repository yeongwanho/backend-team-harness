# First-test implementation and isolated npm preparation v26

Previous turn is progress: c20af5c is pushed, Jest verdict gaps are fixed and
Nest file-flow controls execute seven actual cases (base 3 failures, target 7 passes).
The 3-backend/20-task paired comparison goal is unchanged and remains incomplete.

## Observed call paths

- `runWork` -> `runImplementation` does not require a green baseline. It does
  require approval, source-bound rules, an isolated worktree, and final Gates.
- `materializeWorkspace` copies tracked source and declared verification inputs,
  not node_modules. Generated Jest verification requires local dependencies.
- The benchmark independently requires a green baseline before either provider
  lane; a real Nest repository with no src unit tests therefore never starts.
- Production final verification already enforces minimum executed tests. Never
  weaken that gate or substitute evaluator fixtures for provider-written tests.

## Implementation units (with verification)

1. `src/config/implementation.mjs`, `implementation-setup.mjs`, `src/init-project.mjs`:
   add optional schema-v2 `workspacePreparation` with a fixed `npm-ci-offline`
   kind, contained project path and bounded timeout. Generate it only for the
   uniquely detected npm-lock-backed Jest/Vitest project and preserve it when
   selecting a provider. Legacy absent configuration stays absent. Test schema,
   old readers/default output, nested project, explicit null and backup behavior.
   If JVM verification is selected in a mixed JVM+Node repository, do not attach
   an unrelated npm preparation. Add a mixed-project initialization regression.
2. New `src/core/workspace-preparation.mjs`: validate bounded lockfile and registry
   integrity entries, reject local/git/link dependencies and symlink directories,
   run fixed `npm ci --offline --ignore-scripts --no-audit --no-fund` only in a
   distinct owned implementation workspace. Record hash/count/process status,
   not package/source bodies. No installation in the user's original project,
   no implicit online fallback, no mutable node_modules links. Unit-test failures,
   path and lock boundaries, Windows command construction and exact flags.
3. `src/runtime/implementation-orchestrator.mjs`: run declared preparation before
   provider invocation; compare workspace/original source and refs before/after.
   Save an explicit failed preparation receipt with zero provider attempts when
   dependencies are unavailable or source changes. Preserve resumability after
   cache repair. Cover actual worktree flow, no-provider-on-failure, unchanged
   original, and final tests still required. Do not call this a security sandbox.
   The same `bth work --approve --run` command currently tries to re-approve an
   IMPLEMENTING task and fails. Reuse its existing receipt (never grant a new
   approval); let runImplementation recheck source/plan binding. Test retry after
   zero-attempt preparation failure and truthful in-progress status without run.
   Git core.autocrlf=input normalizes generated .cmd inputs in a worktree. Stage
   exact approved bytes for CRLF/LF-only differences and reject all other changes;
   pin that Git setting in the regression fixture, without changing user config.
   When selected feedback gates equal every configured gate, run full verification
   once instead of repeating identical gates. Never promote a partial result;
   retain feedback then full for strict subsets. Test actual invocation count.
4. New `src/evaluation/empty-test-baseline.mjs` and benchmark wiring: only a
   generated, uniquely detected Jest test gate may qualify for a first-test path.
   Independently enumerate its declared test scope with actual Jest JSON; an
   empty list plus normal exit and unchanged source means `no-tests-discovered`,
   NOT baseline passed. Existing failing/skipped tests, compiler errors, missing
   dependencies and malformed output cannot qualify. Require independent base /
   target acceptance controls before spending provider tokens. Keep final
   minimumTests >= 1 and both lanes' identical final verification.
   Preserve zero provider attempts in benchmark scoring when workspace preparation
   fails. Such a run is not an observed model success/failure; report null with the
   preparation reason and retain its receipt, rather than inventing one attempt.
5. Add focused contract tests and execute the real pinned Nest preflight. Then
   compare one actual Codex BTH/direct pair only if dependency preparation,
   empty-baseline discovery and independent controls all succeed. Report real
   failure as failure; no retries hidden in success@1. Claude availability/cost
   remains separately observed, never fabricated from Codex results.
   First actual BTH attempt prepared dependencies but edited only production code,
   so final empty-test verification failed. After the unchanged direct lane ends,
   strengthen the shared BTH/direct test-authoring instruction and expose required
   gate minimums in schema-v2 requests. Preserve the initial failure; use a new
   protocol ID/output directory for any repeated comparison. Add gate counts and
   bounded gate outcomes to observations so empty-suite failures are diagnosable.
6. Full tests/coverage, mutation, install and docs contracts; evidence under
   docs/evidence/artifacts/v26; document optional config/regeneration and support
   limits; commit and push. No company repositories, production DB or external
   project-management writes. The remaining 14+ tasks and provider comparisons
   remain required for the active goal.

## Checkpoint outcome

- [x] Optional preparation/config/init/provider selection with legacy preservation.
- [x] Private offline npm preparation and source/ref integrity; zero-call failure.
- [x] Same-command retry, exact approved CRLF inputs, no duplicate identical Gates.
- [x] Empty-baseline enumeration without a false PASS; base/target controls before calls.
- [x] Two protocol-separated real Codex pairs. Initial both fail; revised BTH fails
      one of three own tests, revised direct passes four own and seven oracle tests.
- [x] Full regression 433 tests: 429 passed, 0 failed, 4 opt-in skipped; targeted
      mutation 12/12 assertion kills; install, syntax, documentation checks pass.
- [x] README and machine-readable evidence preserve adverse results and scope.
- Delivery is verified separately by Git history and matching remote HEAD; it is
  not inferred from the local checklist.

The mixed JVM+Node preparation suspicion was disproven by the added regression:
portable detection is not performed when JVM verification is selected. No code
change was needed for that path. No stronger performance/completion claim is made.

Next goal work remains: bounded failed-candidate diagnosis, real repair evidence,
reduce irrelevant request context without dropping rules, improve retrieval, and
finish the remaining independent task/provider matrix. Keep the goal ACTIVE.
