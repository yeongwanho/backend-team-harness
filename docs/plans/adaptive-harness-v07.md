# Adaptive verification and budgeted context plan

## Goal

Improve BTH in two measurable places without weakening its completion oracle:

1. minimize time to the first required Gate failure when independent Gates may be safely reordered; and
2. give a coding actor a bounded, query-aware repository map built only from provenance-bearing graph edges.

The release may claim a speedup only for a checked-in benchmark and its stated assumptions. It must not claim that BTH is universally “2x better” than OMO or any other harness.

## Research basis and rejected shortcuts

- Cost-aware test prioritization evaluates how quickly faults are exposed per unit execution cost. For independent fail-fast checks with failure probability `p_i` and duration `c_i`, the adjacent-swap argument orders checks by descending `p_i / c_i` to minimize expected time spent before the first failure.
- Historical estimates are sparse in a new project. Use deterministic Beta smoothing and a minimum observation threshold rather than an opaque model or reinforcement learner.
- Test-impact systems can skip tests only after large-scale calibration and safe fallbacks. BTH has no such production corpus, so this release reorders eligible Gates but never removes a required Gate from a successful run.
- Repository-retrieval benchmarks show that no single retriever dominates, while graph-style repo maps have strong context yield under fixed budgets. BTH will therefore expose an advisory ranked map and its uncertainty, not let the map decide PASS or skip tests.
- OMO/Oh My Pi/Ouroboros patterns worth retaining are explicit state, bounded context, structured traces, staged verification, and retry-safe records. Provider-specific routing and autonomous source writes remain outside this release.

## Safety invariants

1. Configured order remains the default.
2. A Gate can move only when the project explicitly marks it `reorderable: true` and enables adaptive scheduling.
3. Reordering occurs only inside a contiguous run of reorderable required Gates. Fixed Gates, optional Gates, and dependency boundaries never move.
4. A successful run executes every configured Gate exactly once.
5. A required failure keeps the existing fail-fast behavior; all later Gates are recorded as skipped.
6. Scheduler history can influence order only. It cannot influence Gate outcome, evidence tier, source binding, test counts, or verdict.
7. Missing, stale, unsafe, or corrupt local history falls back to configured order and is reported in the run record.
8. Codegraph output remains `REPORTED`, advisory, and explicitly forbidden for PASS decisions or test skipping.
9. Ranking uses only exact indexed nodes and `static-import-resolved` edges. Lexical query matches may seed ranking but never create edges.

## Working set

- `src/config/verification.mjs`: versioned adaptive-scheduling configuration and per-Gate reorderability validation.
- `src/core/gate-scheduler.mjs`: pure signature, Beta-smoothed estimates, `p/c` scoring, segment-safe ordering, and expected-feedback calculations.
- `src/core/gate-history-store.mjs`: bounded symlink-safe local aggregate with atomic persistence and per-Gate signature isolation.
- `src/adapters/verification-tool.mjs`: obtain a schedule, execute it, persist executed observations, and include the complete scheduling decision in evidence.
- `src/core/run-record-store.mjs`: retain compact scheduling provenance in sealed records.
- `packs/codegraph-advisory/run.mjs`: deterministic graph ranking primitives and richer provenance metadata.
- `src/core/code-context.mjs`: bounded query-aware Personalized PageRank over an already generated graph.
- `src/runtime/plan-export.mjs`: optional ranked context hints with a hard character budget and an explicit advisory authority label.
- `src/cli.mjs`: context-budget option and version update if the export surface changes.
- `scripts/benchmark-adaptive-verification.mjs`: deterministic benchmark comparing configured and learned failure-feedback cost without sleeping.
- tests for config, scheduler mathematics, history corruption/fallback, verifier invariants, graph ranking, context budget, and CLI output.
- `README.md`, architecture/evidence/roadmap docs, and a reviewer-readable QA report.

## Atomic implementation and verification units

1. Add failing pure scheduler tests.
   - Prove configured-order fallback with insufficient samples.
   - Prove descending posterior failure-probability/duration order once the threshold is met.
   - Prove stable tie-breaking and exact Gate identity preservation.
   - Prove fixed/optional boundaries cannot be crossed.
   - Prove the pairwise expected-cost formula and a controlled fixture with at least 2x lower expected failure-feedback time.
2. Implement the pure scheduler.
   - Use canonical Gate signatures so changed commands/results do not inherit unrelated history.
   - Use bounded finite numeric inputs and deterministic Beta posterior estimates.
   - Return a full explanation for every Gate: original index, final index, samples, failures, duration estimate, probability estimate, score, and fallback reason.
3. Add failing history-store tests, then implement safe local learning.
   - Store aggregates only: signature, counts, failures, total duration, and last observation time.
   - Enforce schema, count, size, path, symlink, and numeric limits.
   - Use atomic replacement inside `.backend-harness/local/`.
   - Treat corruption as optimization-unavailable, not verification failure, and never overwrite the corrupt file implicitly.
4. Integrate scheduling into verification.
   - Load before execution, update after execution, and record the selected order.
   - Retain full-run PASS semantics and existing fail-fast semantics.
   - Add integration tests that assert every successful Gate executes once and that adaptive order cannot create a false PASS.
5. Add failing graph/context tests.
   - Personalized seeds come only from bounded task/query tokens matched to node path or qualified name.
   - Propagation follows only stored exact import edges.
   - The selected list fits its character budget deterministically and records omitted node count.
   - Empty/no-match queries fall back to global graph importance without inventing relevance.
6. Implement advisory budgeted context and plan export.
   - Validate the generated graph as a bounded regular non-symlink file.
   - Verify its declared advisory/forbidden-use contract before reading it.
   - Include top paths, scores, provenance, budget use, graph generation, and explicit limitations.
   - Absence or invalidity of the optional graph must not block plan export; expose the reason.
7. Add deterministic benchmark tooling.
   - Report configured expected time, adaptive expected time, ratio, Gate order, and no-skip invariant.
   - Fail the benchmark command when the checked-in fixture does not reach 2x.
   - Do not substitute simulated duration for real end-to-end latency claims.
8. Run the complete verification matrix.
   - `npm run check`
   - real JVM E2E
   - real MySQL E2E
   - adaptive benchmark
   - CLI smoke for plan export with and without graph context
   - dependency audit
9. Review the final diff against every invariant, write observed results and residual risks, commit, and push the feature branch.

## Acceptance criteria

- Zero required Gate is skipped on any PASS path.
- Existing projects that do not opt in preserve byte-for-byte configured Gate order semantics.
- Corrupt optimizer state cannot alter verdict or silently become trusted history.
- The deterministic benchmark demonstrates at least `2.00x` expected failure-feedback improvement on its declared fixture.
- Plan export never exceeds the requested context character budget and every returned path is an existing graph node.
- Graph output and run records explain how every ranking/scheduling decision was produced.
- Normal, real JVM, and real MySQL suites pass before push.

## Residual limits that must remain explicit

- `p_i / c_i` is optimal only for the declared independent fail-fast model and estimated probabilities/costs; correlated/order-dependent Gates must stay fixed.
- Historical behavior can drift. This release resets by Gate signature and uses bounded aggregates, but does not claim a production-calibrated predictor.
- Personalized PageRank improves navigation candidates, not semantic completeness. Reflection, Spring runtime wiring, generated code, SQL ownership, and method-level call resolution remain outside the current graph.
- The 2x benchmark is a controlled scheduler result, not an end-to-end product comparison with OMO.

## Completion record

Implemented and verified on 2026-08-30. The full observed command matrix and residual risks are recorded in `docs/evidence/adaptive-harness-v07-qa.md`. External research and adopt/reject decisions are recorded in `docs/RESEARCH-2026-ADAPTIVE-HARNESS.md`.
