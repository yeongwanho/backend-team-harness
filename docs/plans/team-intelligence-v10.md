# Team intelligence v1.0 implementation plan

## Goal

Raise Backend Team Harness from a strong single-maintainer verification kernel to a safer team workflow without allowing model claims, custom project code, or merge accidents to manufacture PASS.

This change addresses four independently identified gaps:

1. company conventions cannot extend the closed built-in fact vocabulary;
2. interview answers can contradict each other without a deterministic candidate;
3. shared linear task ledgers have no explicit writer/handoff boundary;
4. code-impact ranking has no versioned Recall@20 acceptance fixture.

## Non-goals

- no model provider or semantic claim is built into Core;
- no automatic code merge, deployment, production database access, or test skipping;
- no silent auto-merge of divergent task histories;
- no claim that a synthetic gold fixture proves production localization accuracy.

## Work units

### 1. Project-owned facts

- Add a strict `.backend-harness/project-facts.json` contract.
- Permit bounded arbitrary fact identifiers under a project-owned namespace.
- Require every confirmed value to cite a project-contained regular Markdown source and existing heading.
- Treat provider conflicts as `conflict`; never let a custom fact replace a built-in fact.
- Include source, authority, diagnostics, and fact count in `intelligence inspect` output.
- Generate a safe empty starter contract from `bth init`.
- Verify missing, malformed, oversized, symlinked, duplicate, built-in-collision, unknown, and conflict cases.

### 2. Deterministic interview contradiction candidates

- Extend interview answers with optional bounded structured claims, while preserving free-text compatibility.
- Start with explicit booleans and bounded module names rather than NLP guesses.
- Produce advisory contradiction candidates from deterministic claim pairs and project facts.
- Require a human to revise or explicitly resolve every candidate before finalization.
- Store the candidate source and resolution in the hash-chained interview history.
- Never promote a candidate into project fact or PASS evidence.

### 3. Team writer and handoff boundary

- Reproduce divergent task ledger histories from one common revision.
- Add a source-controlled single-writer lease to each task, distinct from local process locks.
- Require actor-matching context, plan, and implementation authoring while the lease is active.
- Add explicit handoff bound into the current hash-chain revision with an audit event.
- Detect Git-unmerged task/interview ledgers before parsing and return an actionable conflict instead of a generic JSON/hash error.
- Document that divergent histories are never auto-merged; they require explicit Git resolution and complete hash-chain validation.

### 4. Impact gold measurement

- Add a versioned synthetic JVM fixture with requirements, expected paths, and negative distractors.
- Measure Recall@5 and Recall@20 using the same bounded code-context API used by plan export.
- Fail the acceptance test below Recall@20 0.85.
- Label the result synthetic and keep real multi-project adoption unchecked.

## Verification

- failing-first tests for every contract, transition, permission boundary, and merge-risk path;
- `npm run check`;
- `npm run test:windows-contract`;
- existing real JVM and MySQL hosted workflows unchanged and re-run in CI;
- benchmark the new fact and contradiction paths for bounded behavior;
- record reviewer-readable evidence under `docs/evidence/`.

## Files expected to change

- `src/config/project-facts.mjs` (new)
- `src/adapters/project-intelligence.mjs`
- `src/core/constraint-engine.mjs`
- `src/core/interview-state.mjs`
- `src/core/interview-store.mjs`
- `src/runtime/interview-orchestrator.mjs`
- `src/core/task-state.mjs`
- `src/core/task-store.mjs`
- `src/cli.mjs`
- `src/templates.mjs`
- targeted tests under `test/`
- `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and QA evidence
