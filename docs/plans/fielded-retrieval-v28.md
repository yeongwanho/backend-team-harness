# Fielded retrieval v28

The previous goal turn made verified progress: f10bb39 was pushed and the
retained public Nest task reached DONE after an apply lifecycle fix. The full
three-backend / twenty-task / Codex-and-Claude goal remains active.

## Evidence and scope

The latest actual Nest request has Recall@5=0, Recall@20=0.5. Its successful
implementation does not establish adequate initial context. Re-running the
existing plan-only control now materializes all 20 tasks. The selected-query
baseline at 2,000 characters has mean Recall@5 0.368214, Recall@20 0.436548,
nDCG@20 0.376748, and four zero-recall tasks. Raw evidence is retained in
`/tmp/bth-v28-before-ranking.json`.

Call path: work/export -> validated interview requirement -> bounded graph
indexer -> `rankCodeContext` -> personalization -> PageRank -> bounded selection.
The current prior merges path, qualified name and imported search terms into
one deduplicated 64-term bag. CamelCase is partially split, but snake_case and
acronym boundaries are not. Imports can therefore stand in for file identity.

## Predeclared candidate (not corpus-specific tuning)

Use the existing graph fields; do not add embeddings, model calls, dependencies,
source-body reads, or task/gold-specific aliases. Experiment with a fielded
saturating prior over file/declaration identity (weight 2), directory path
(weight 1), and existing search terms (weight 1), k1=1.2 and b=0.75. Terms are
deduplicated per field before scoring; this is a bounded metadata adaptation,
not a claim to reproduce a paper's document retrieval results. Keep PageRank
weights, blend, hard output budget, test co-selection and advisory authority.
Split snake_case/CamelCase/acronyms while retaining exact identifiers. Preserve
current fallback and impact-seed semantics initially.

Reference: Robertson/Craswell/Zaragoza, Microsoft Cambridge at TREC-14,
https://trec.nist.gov/pubs/trec14/papers/microsoft-cambridge.enterprise.pdf,
describes field length normalization, weighted pseudo-frequency, then saturation.
This supports the design mechanism, not an expected improvement on this corpus.

## Atomic edits and checks

1. Read ranker/index fields and capture all-20 baseline before any code edit.
   Add a small owned public graph probe to explain the actual Nest miss without
   modifying public mirrors or calling a model.
2. `src/core/lexical-retrieval.mjs`: move token handling and implement the fixed
   fielded prior with bounded inputs; preserve fallback/seed output contract.
   `test/lexical-retrieval.test.mjs`: corpus-independent declaration-vs-import,
   snake_case/acronym, repeated-term saturation, no-match, empty graph,
   deterministic order and large-graph bounds. Tests fail before implementation.
3. `src/core/code-context.mjs`: consume the prior, keep graph validation and
   output authority/budget; add truthful lexical metadata. Re-run code-context,
   on-demand/export, first-test/provider and mutation tests.
4. `scripts/benchmark-retrieval-query.mjs`: bind ranking/indexer source hashes as
   well as query source. Use fresh output paths. Compare all twenty tasks with
   the same base/source, requirement, graph and 2,000-character budget. Preserve
   per-task regressions and zero matches, distinguish historical filename gold
   from exhaustive semantic impact. Do not call static recall task completion.
5. Run a fixed large synthetic graph for bounded ranking time/memory, and actual
   work/export requests for policy/approval/source invariants. No ranking change
   may grant verdict/test-skipping authority. Reject a candidate that only
   improves the motivating Nest task or materially harms broader localization.
6. Record reviewed findings and limitations, full QA/coverage/targeted mutation,
   then commit/push a verified checkpoint. Provider effect remains unmeasured
   unless a separate paid comparison actually runs. Continue the full goal.

## Acceptance limitations

The twenty known tasks are an engineering regression corpus, not unseen data.
Do not grid-search weights against these gold paths or claim generalization.
Input graphs omit arbitrary content semantics; a ranker cannot retrieve a new
file absent from the base or infer policies with no source evidence. Further
independent acceptance oracles and Codex/Claude comparisons are still required.

## Experiment review and narrower revision

The fielded candidate is rejected as a default: mean Recall@20 increased from
0.436548 to 0.487738, but spring-06-pet-update fell from 1 to 0 and
nest-05-auth-email-update from 0.285714 to 0.142857. Field normalization changes
more than identifier parsing; average improvement does not justify this loss.
The source is retained at `/tmp/bth-v28-rejected-fielded-prior.mjs`, with results
at `/tmp/bth-v28-fielded-ranking.json`. These remain failed-experiment evidence.

Test a narrower hypothesis next, without tuning against gold: retain the
original binary-term IDF scoring and single 64-term metadata bag. Only fix
identifier splitting and, for an explicitly written code identifier such as
`RefundPolicy`, give its actual filename/declaration one additional copy of
that identifier's IDF. Natural-language words receive no ownership bonus.
Retain only query-matching terms per node instead of all metadata term sets;
empty queries can return uniform weights without parsing node text.

The same two failing-first tests cover identifier ownership and snake_case.
Add tokenizer/bounds/fallback/legacy-equivalence/performance tests in
`test/lexical-retrieval.test.mjs`. Keep the indexer and its installed assets
unchanged: missing callable declarations are a separate limitation, not an
excuse to expand this patch. Re-run all twenty known tasks at the same budget,
including original per-task regressions. Pin ranker, tokenizer and indexer
source hashes in the benchmark before recording final results.

Performance evidence: add `scripts/benchmark-lexical-retrieval.mjs` to compare
the HEAD f10bb39 prior and candidate in separate Node processes, on fixed
10k/100k-node metadata with empty, matching and absent queries. Record medians
and process peak RSS; verify equal weights when identifier changes are absent.
This measures the lexical prior only, not end-to-end implementation speed.
Extend `scripts/mutation-smoke.mjs` with tokenizer and ownership mutations to
prove the new regression assertions can actually detect these faults.
