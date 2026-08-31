# v33 — a usable, honest FastAPI baseline before paid implementation

Previous turn: verified progress, pushed `03a9d4c`. The complete 3-backend/20-task
paired implementation goal remains active. No smaller completion criterion.

## Current evidence and boundaries

The v32 generated product runner executes all 55 original FastAPI tests against
an explicitly disposable PostgreSQL DB: 52 pass, 3 fail. One lacks a synthetic
email transport/sender; two pre-start tests patch `sqlmodel.Session` rather than
the imported application binding, do not correctly bind the context manager,
and call `called_once_with` as if it were an assertion. These are not task model
failures. Preserve them as the observed original baseline.

No company source, production DB, private dotenv, external email, authentication
changes, or global runtime changes. All execution is in owned public clones.
No subagents. No model calls until an explicit baseline and independent control
are valid. Never exclude original tests or relax required JUnit checks.

## Edit / verification units

1. `fixtures/fastapi/full-test-bootstrap.py`: add an explicit in-memory SMTP
   transport at the library backend boundary. Preserve application send_email,
   MIME construction and original route assertions; accept synthetic addresses
   only, no socket/real delivery, no body in logs. Set a synthetic sender in
   `full-test-run.mjs`. Prove actual password-recovery route and original suite.
2. Add two fixed pre-start test fixtures retaining original test names and
   intent: patch the application's Session binding; bind __enter__; assert
   session construction, exactly one execution, SELECT 1 and normal exit.
   Apply only after original-byte hashes match; never change production code.
   Keep the original failed-run evidence. All baseline corrections are visible
   to both providers and separate from model changes/hidden task acceptance.
   The original random_email helper generates arbitrary .com domains. Pin an
   evaluation-only copy of that test helper to random local parts at example.com
   so the non-delivering transport can reject all non-test domains. Bind its
   original hash as well. Production email generation is not changed.
3. Add generic evaluation-only, hash-pinned project preparation overlays:
   strict paths/keys/bounds, expected old hashes for replacements, exact new
   fixture hashes, atomic no-clobber writes, declared protected verification
   inputs and explicit offline preparation config. Core project discovery stays
   generic and does not recognize the public FastAPI repository by name.
4. Extend provider comparison configuration only for the first FastAPI task
   being exercised, with those exact fixtures and verification wrapper. Freeze
   its setup before either lane; retain it through baseline checking and normal
   `bth work`. Direct and BTH must use identical baseline code/test settings.
   Original setup/ordinary-test failure still prevents paid implementation.
   Add `src/evaluation/provider-project-preparation.mjs` to initialize, apply,
   source-bind and prepare that baseline, restricted to the sanitized single-
   commit evaluator clone. Route both script lanes through the same helper;
   fixture-aware preflight preserves the contract instead of deleting it.
5. Guard all evaluator-owned overlay files against provider edits (including
   inside allowed backend prefixes). Direct lane re-hashes actual files, not
   merely Git paths. BTH uses the normal declared-input integrity guard. Make
   committing an already tracked harness contract a no-op when unchanged.
   Also snapshot the complete declared input set in the direct lane, including
   generated verifiers and build metadata not supplied by the overlay. Compare
   actual bytes before and after both provider and verification, independent of
   Git assume-unchanged flags. Missing inputs must stop execution before payment.
6. Tests: preimage mismatch, path escape, symlink, partial-write prevention,
   repeated preparation, missing fixture, tamper detection, identical baseline
   projection and before-provider failure. Actual 55-test baseline first;
   strict task-specific missing-user oracle remains independent.
7. If baseline + oracle pass, run one actual FastAPI requirement in both lanes
   using the same provider/model/profile and record first-attempt correctness,
   rule violations, elapsed time, complete observed token/cost data. Preserve
   failures; unknown cost remains unknown. Do not substitute replay for a model.
8. Advance comparison protocol; run full regression, coverage, selected mutation,
   installed-package and document checks. Record initial failures, preparation
   modifications, final artifacts and omitted real-Windows/MySQL scope; push.

If the selected original baseline cannot be made valid without modifying the
task behavior, do not make it pass by weakening assertions. Record that case as
unready and continue another in-scope task. Overall goal remains unchanged.

## Observed completion of this increment

- Common prepared baseline: 57/57; all 55 original test names retained.
- Actual Codex pair: both first attempts pass 58/58 and independent 7/7.
  BTH 84,969ms vs direct 69,952ms, total tokens 233,871 vs 110,460.
  This is not a speed/cost win; USD remains unknown.
- Late direct transitive-input integrity gap reproduced with an assertion failure
  and fixed; both paid candidates checked against contemporaneous preflight hashes.
- Full regression 524/520 pass/0 fail/4 skip; selected mutations 29/29 killed;
  coverage, install, syntax and docs checks passed. Full goal is still active.
- Next performance work: measure and reduce duplicate small-task request/policy
  overhead without weakening rules, test scope or evidence binding; finish the
  remaining public tasks and Claude comparisons before making completion claims.
