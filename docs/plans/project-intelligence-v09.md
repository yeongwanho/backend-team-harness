# Project intelligence and optimized execution 0.9

## Goal

Turn the existing verification kernel into a deterministic substrate that gives a coding agent source-bound project rules, explicit contradictions, and a higher-fidelity impact map before any source-writing adapter is allowed to act.

## Product boundary

- Keep BTH's PASS oracle model-free and evidence-driven.
- Treat documentation, heuristic source observations, and executable proof as different authorities.
- Never invent a company rule. Missing inputs remain `unknown`.
- Do not add deployment, production database access, ambient credentials, or implicit source writes.
- Any future implementation adapter must work in an isolated worktree, obey an approved plan, use bounded repair attempts, and return to the existing BTH verifier for completion.

## Work packages

### A. Deterministic project intelligence

1. Add a bounded, strict project-rule contract with provenance and three-valued evaluation (`confirmed`, `unknown`, `conflict`).
2. Extract source-bound facts from Git change status, build configuration, verification Gates, Flyway migrations, policy documents, and Java/Kotlin structure.
3. Add reusable rule types for required facts, forbidden facts, change coupling, migration immutability, and dependency direction.
4. Expose `bth intelligence inspect` with both human-readable and JSON output.
5. Include evaluated rules and unresolved contradictions in interview context and approved plan export.

### B. Higher-fidelity impact graph

1. Replace the single-declaration import scan with multi-declaration Java/Kotlin indexing.
2. Record explicit edge provenance for imports, inheritance, implementation, constructor/field injection, controller routes, entities, tables, and tests.
3. Condense strongly connected components before impact expansion so cycles cannot explode the result.
4. Use bounded reverse reachability plus query-personalized ranking; keep heuristic edges advisory.
5. Add compact or segmented persistence so the public source limits and the 16 MiB report boundary agree.

### C. Optimized execution preparation

1. Extend Gate scheduling from a flat list to an explicit dependency DAG.
2. Schedule only ready Gates, retain fail-first `p/c` ordering inside a ready set, and preserve configured order on missing or correlated evidence.
3. Support bounded parallel execution only for Gates that explicitly declare independence and resource classes.
4. Record scheduling decisions, cache/setup assumptions, and fallback reasons in sealed evidence.

### D. Isolated implementation and recovery port

1. Define a provider-neutral adapter contract without embedding a model in Core.
2. Create a task-owned Git worktree for implementation and deny writes outside it.
3. Enforce approved path/change budgets and an explicit tool permission profile.
4. Run verify, produce structured failure classification, and permit a bounded repair loop.
5. Never merge, deploy, or access production automatically.

## Verification

- Unit tests for every rule operator, unknown/conflict transition, graph edge, SCC, budget, scheduler boundary, permission denial, and repair limit.
- CLI integration tests for intelligence inspection, interview blocking, plan export, and stable JSON contracts.
- Entire deterministic regression suite remains green.
- Real JVM and disposable MySQL tests remain green.
- Add deterministic performance fixtures for incremental inspection, graph memory/output bounds, impact Recall@budget, and scheduling latency.
- Validate on at least two independently maintained backend repositories before claiming team readiness.

## Measured acceptance targets

- Known project-rule conflicts: 100% of seeded conflicts detected, no invented confirmed rule.
- Impact localization: Recall@20 at least 0.85 on a versioned gold fixture.
- Repeated unchanged inspection: no source file reparsed when its content identity is reusable.
- Every executable recommendation has provenance and an explicit authority tier.
- A failed implementation cannot become `VERIFIED` without the unchanged-source BTH evidence contract.
