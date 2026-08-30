# Product goal v1.4

## North-star outcome

Backend Team Harness must let a backend developer run one workflow such as
`bth work "add a compatible user-status CRUD endpoint"` in an unfamiliar
repository. The harness must discover source-bound project conventions and
adjacent examples, ask only unresolved blocking questions, create one short
reviewable plan, implement in isolation, execute the narrowest defensible
feedback loop followed by the required verification boundary, and produce an
integratable diff with reproducible evidence.

The product is not complete because it has more states, seals, providers, or
algorithms. It is complete only when measured backend tasks finish faster and
with fewer convention or verification mistakes than direct model execution.

## Acceptance metrics

Measure the same task corpus through BTH and direct Codex/Claude execution.

- Three independently maintained backend repositories, including one
  monorepo-scoped service and one repository outside the JVM/Spring starter.
- At least twenty versioned tasks covering CRUD, bug fix, API compatibility,
  MySQL migration/query behavior, and cross-module impact.
- `success@1`, repair rate, convention violations, escaped-scope edits, and
  deterministic verification outcomes.
- Impact-localization Recall@5, Recall@20, and nDCG with human-declared gold
  files or regions.
- Wall-clock time split into harness overhead, provider time, and verification
  time.
- Provider total input/output/cache tokens and cost where the CLI exposes it.
- A second developer can initialize and complete one task in thirty minutes or
  less without repository-specific coaching.

No synthetic benchmark alone may satisfy a production acceptance metric.

## Delivery order

### Phase 1 — one-command vertical slice

1. Add `bth work` as the canonical happy path over existing deterministic
   components rather than adding a second state engine.
2. Infer what is already known from source and ask only missing blocker
   decisions; do not force the fixed five-question ceremony for a small task.
3. Present one concise plan/authority summary and require at most one approval
   before source writing.
4. Keep implementation in the existing detached worktree and expose a guarded
   apply operation that rechecks the immutable base and exact diff before
   integration.
5. Preserve advanced interview/task commands as inspectable escape hatches.

### Phase 2 — convention compiler and impact evidence

1. Derive naming, layering, DTO/error, transaction, persistence, and test
   patterns from source-bound representative files with citations.
2. Separate discovered observations from team-declared blocker policy.
3. Enforce deterministic convention rules after editing instead of trusting a
   provider claim that it read the files.
4. Upgrade localization with compiler/bytecode or language-server provenance
   where available and retain lexical/structural fallback labels.
5. Add Spring route, repository/query, schema/table, event, and test ownership
   evidence without promoting heuristic edges to verdict authority.

### Phase 3 — fast but conservative feedback

1. Add measured module/test recommendations using build dependencies and
   runtime coverage observations.
2. Run selected feedback first, then escalate to the complete required Gate
   boundary whenever evidence is absent, stale, or ambiguous.
3. Replace synthetic performance claims with real overhead, correlation, and
   completion measurements.
4. Keep MySQL lifecycle checks first-class while making dialect/framework
   support pluggable.

### Phase 4 — product hardening

1. Split the CLI router and implementation orchestration into bounded command,
   preparation, execution, certification, and integration services.
2. Introduce stable typed error codes while preserving reviewer-readable
   messages and CLI compatibility.
3. Add line/branch coverage and focused mutation testing for verdict, state,
   permission, redaction, and source-binding code.
4. Normalize provider duration/token/cache/cost observations into one schema.
5. Strengthen evidence redaction and add fixtures for source, PII, credentials,
   and model-output leakage.
6. Generate and test CLI documentation from the command contract.

### Phase 5 — adoption and release

1. Run real Windows Codex/Claude implementation and descendant-cleanup
   fixtures.
2. Validate two-developer handoff, divergent Git history, and conflict recovery.
3. Validate install, upgrade, configuration migration, and clean-machine
   onboarding.
4. Publish a compatibility policy, changelog, migration notes, and release
   candidate only after the real task corpus passes.

## Explicit non-goals until the metrics justify them

- More provider integrations.
- Multi-agent runtime, long-term memory, dashboard, or SaaS control plane.
- Additional hash/ledger machinery without a reproduced integrity defect.
- Claims that BTH is a multiple of another harness without a shared benchmark.
- ML/RL or additional scheduling mathematics before real observations show the
  current decision rule is the bottleneck.
