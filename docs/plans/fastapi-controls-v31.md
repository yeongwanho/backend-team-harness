# v31: third-backend behavioral controls

Previous goal turn was verified progress: 52a3a13 is pushed. The full three-backend,
twenty-task paired Codex/Claude objective remains active; replay is not success@1.

## Scope mapped before edits

FastAPI tasks 04 (unknown-user password verification/recovery/reset) and 05
(missing-user HTTP response and authorization) have no independent controls.
Both pinned sources have a uv lock and real SQLModel/PostgreSQL implementation.
The public mirror origin and target-parent relationships are checked before runs.
Current local PostgreSQL 16 image is cached; use its exact digest, no image pull.
Only fresh evaluator clones and labeled temporary containers/networks are writable.
Never load user/project dotenv files, mail externally, access company DBs, or prune
existing Docker data. The product's MySQL focus is unchanged.

## Atomic implementation and verification

1. Read actual source/requirements, pytest setup, package lock and runtime paths.
   Identify normal, unauthorized, missing, reset-invalid and known/unknown email
   behavior. Do not claim constant wall-clock timing or concurrent safety.
2. Add a failing-first task-acceptance regression for JUnit setup errors. Tighten
   base control to require executed selected assertions, at least one failure,
   and zero errors anywhere; setup/collection failures are not reproduced bugs.
   Add a selected mutant for that boundary; preserve existing independent cases.
3. Add hash-pinned `fixtures/fastapi/run.mjs`, `conftest.py`,
   `test_missing_user.py`, `test_auth_enumeration.py`. The runner is test-only,
   explicitly offline for uv, skips local project build, pins Python 3.12, and
   creates only a temporary PostgreSQL instance with loopback port and bounded
   resources/storage. Always verify and remove only its own labeled resources.
   Pytest disables autoload, uses only the oracle directory, uses real HTTP/JWT/
   service/SQLModel/DB paths, blocks non-local sockets and dotenv loading, and
   captures mail via a test double. Failures must still produce honest JUnit.
4. Pin fixture hashes and all expected case names in provider-comparison.json.
   Add configuration/runner contract tests. No paid model call before valid base
   failure and target pass. If the target itself violates a stated requirement,
   retain the failure and mark that control unconfirmed, never weaken the oracle.
5. Execute both base/target controls. Audit actual JUnit outcomes and DB cleanup.
   Address only test/runtime preparation errors, keeping failure history. Re-run
   existing controls affected by the stricter predicate when practicable.
6. Full regression/coverage, mutation, syntax/install/document contract checks.
   Write reviewer-readable Korean evidence and redacted source-bound JSON,
   update the actual controls count (not configuration count), and push.

Remaining full-goal work: all twenty cases, paired actual providers, faster/cheaper
implementation evidence, remaining runtime-recovery gaps, real Windows and DB
coverage. No smaller completion definition is substituted.

## Environment findings before changing the runner

First controls stopped at missing offline wheels; both pinned public lockfiles
were prepared separately with registry-host validation, no build/project install,
and unchanged source. The second controls got through offline preparation but
Docker 20.10.17 did not publish a host port on the internal network. All created
resources were removed. Use a dedicated bridge and request loopback-only binding
with an ephemeral random DB password; do not claim OS egress enforcement or
certified host-only reachability on this old Docker. No private data/host mounts
or production endpoints enter this public fixture. Preserve both failure rounds.

## Regression controls affected by the stricter predicate

The rerun rejected the whitespace search target-tests (unmatched Mockito stub
returns null) and the binding fixture (visit request raises an application
exception). Preserve those outcomes. Do not relax the no-error rule. Replace the
search oracle with a hash-pinned, evaluator-owned `OwnerSearchAcceptanceTests.java`
using a non-null repository fallback and explicit HTTP/query assertions. Retain
leading/trailing/blank behavior and add unchanged-input/no-result guards. In
`BinderAcceptanceTests.java`, assert that the visit HTTP action completes without
an exception before asserting response and object identities. Setup remains
outside that assertion. Pin changed fixtures, add contracts, and rerun both
base/target pairs plus final configuration/QA. This makes the application behavior
an explicit assertion, not an arbitrary JUnit error accepted as a reproduced bug.

## Checkpoint verification

- [x] FastAPI source/dependency/DB path mapped; final auth 9 and user-read 7 cases verified.
- [x] Setup-error regression failed first, passed after the conservative predicate, and its mutant was killed.
- [x] Disposable PostgreSQL fixtures executed; owned resources absent after cleanup.
- [x] All eight older controls rerun. Two error-based Spring controls replaced/refined with explicit assertions and rerun.
- [x] Project formatter gate was initially red; pinned Spring JavaFormat applied to the two test fixtures only, then live controls passed.
- [x] Current oracle/evaluator hashes match ten confirmed tasks across all three backends; 58 selected target assertions pass.
- [x] Full regression 482/478/0/4 (total/pass/fail/skip); 23 selected mutants killed; syntax, install, fixture and document contracts checked.
- [x] Redacted failure history, current controls index and QA source/log hashes written under `docs/evidence/artifacts/v31/`.

The full 20-task paired-provider goal is not complete. Next execution work must
prove the product's third-backend preparation and implementation flow, not count
this model-free control checkpoint as an AI success or efficiency result.
