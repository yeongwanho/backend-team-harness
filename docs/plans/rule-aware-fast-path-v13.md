# Rule-aware fast path v13

## Goal

Keep small backend changes fast without allowing the implementation provider to guess a project's conventions.

## Invariants

- Automatic `fast` selection requires structured evidence that the change is small, all blocker rules are resolved, and no non-blocking rule has a known conflict.
- Automatic `fast` selection also requires at least one source-bound adjacent-code navigation entry.
- Missing blocker or adjacent-code evidence falls back to `balanced`; a blocker conflict escalates to `deep`, while a known non-blocking conflict selects `balanced`.
- A smaller reasoning profile never skips declared verification Gates.
- The provider must read bounded project-rule and knowledge-document sources and inspect adjacent production and test examples before editing.
- Provider output remains non-authoritative; deterministic Gates alone certify the result.

## Changes

1. Extend adaptive profile selection with project-rule and adjacent-code readiness.
2. Load finalized interview rule evaluation and knowledge-document paths once with structured implementation claims.
3. Re-evaluate provisional automatic `fast` after source-bound code context is loaded.
4. Add a bounded `projectConventions` contract to provider request schema v2.
5. Strengthen the provider instruction for naming, layering, DTO/error, transaction, persistence, and test conventions.
6. Add failing-first unit and integration coverage for fallback, escalation, request contents, and prompt behavior.

## Verification

- Focused model-provider and implementation-orchestrator tests.
- Full Node test suite.
- Existing JVM, Windows-contract, MySQL, and adaptive benchmark commands where available.
- Review generated request artifacts for bounded paths only; no source bodies, secrets, or private machine paths.
