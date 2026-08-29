# Harness v1 implementation plan

## Goal

Turn the existing source-bound verification core and native interview into one
provider-neutral backend work contract:

```text
requirement -> observed project facts -> human decisions -> canonical plan
            -> explicit approval -> external implementation adapter
            -> deterministic verification -> structured failure diagnosis
```

The model or external coding agent may propose and implement work, but it must
never create a BTH PASS, approve its own plan, silently broaden scope, or erase
the first failing run.

## Invariants

1. `EXECUTED` means a project command actually returned a structured execution
   result. Permission denials and pre-result tool errors use `CONTROL`.
2. `REPORTED` findings may block PASS but cannot create it.
3. Human decisions remain explicit. Project observations may specialize a
   question but may not fill in its answer.
4. Rebinding an unfinished interview writes a new immutable context snapshot;
   the old source and audit events remain readable.
5. Plan approval binds the current Git fingerprint, task text, and canonical
   `plan.json` digest when a native interview produced the plan.
6. Plan export grants no write authority and no verdict authority. It is a
   portable input contract for an external agent adapter.
7. Diagnosis is derived from immutable run records. It may recommend a rerun;
   it may not turn a failure into PASS.

## Edit and verification units

1. Evidence authority
   - Update evidence/run stores and verification callers.
   - Add permission-denied and pre-result failure regression tests.
2. Fact-aware interview
   - Include parsed quality gates and bounded policy metadata in the context.
   - Specialize DB, verification, scope, and constraint hints from observations.
   - Add CLI-visible facts and prior decisions.
3. Interview lifecycle
   - Add explicit `revise` and `rebind` commands.
   - Store context snapshots by digest for crash-safe rebind.
   - Test drift recovery, revision, tamper detection, and concurrency.
4. Canonical plan and AgentPort
   - Bind `plan.json` digest into the task and approval receipt.
   - Add read-only `task export-plan` with source and approval validation.
   - Test artifact tampering and manual-task compatibility.
5. Failure diagnosis
   - Validate and load the latest sealed run record.
   - Add `bth diagnose` with failed gates, failed tests, rerun argv, and safe next
     actions.
6. State-machine assurance
   - Exhaustively enumerate bounded transition sequences and assert approval,
     evidence, and terminal-state invariants.
7. Documentation and QA
   - Update README, architecture, evidence contract, and roadmap.
   - Run `npm run check`, real JVM E2E, and real MySQL E2E when the required
     local runtimes are available.

## Out of scope

- production database access, deployment, credential discovery, or secret
  forwarding;
- a model-specific runtime embedded in Core;
- graph-based test skipping or model-generated PASS;
- automatic retry that hides a failed attempt;
- remote attestation or signed CI provenance.
