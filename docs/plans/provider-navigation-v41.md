# v41 — useful adjacent code with bounded provider navigation

Previous turn: progress. Commit 7fb29f0 added a real prepared authentication task
and two BTH/direct provider pairs. All four passed defined tests, but efficiency
was mixed; this is not the full 3-backend/20-task goal.

## Explored evidence

- `packs/codegraph-advisory/indexer.mjs` connects collocated Python/ECMAScript
  tests, not parallel nested `tests/...` versus `app/...` or `src/...` trees.
  v40's source-bound convention compiler found login/test_login; the graph did
  not. `rankCodeContext` already co-selects both directions of a tests edge.
- `src/core/provider-context.mjs` bounds examples but forwards every ranked graph
  entry. The v40 deep request contained 47 entries; login implementation was 8th.
- The approved task, declared rules, review signals and authority are separate
  from advisory file navigation. Keep those intact. Missing Claude direct read
  paths and native-full-workflow baselines remain outstanding, not fixed by this.

## Atomic work and verification

- [x] In `test/semantic-graph.test.mjs`, fail first on parallel nested Python and
  ECMAScript test/production layouts, module isolation, ambiguous candidates and
  a selected test co-selecting its implementation. Preserve collocated/JVM cases.
- [x] In `test/provider-context.test.mjs`, fail first on 8/16/24 navigation entry
  limits for fast/balanced/deep, honest omitted counts and character accounting,
  original ranking within the selected prefix, input immutability, and complete
  declared rules/authority/DB signal preservation. These are navigation limits,
  not a test-skip or scope-approval mechanism.
- [x] Update only the graph's bounded path candidate resolver and corresponding
  coverage metrics. Match within the same parent/module and exact relative path;
  ambiguous existing candidates get no edge. No global basename search or graph
  authority escalation. Keep standalone pack installation working.
- [x] Update provider projection and the small prompt guidance/docs surface.
  Reduce only advisory navigation entries and redundant adjacent paths; retain
  the full approved plan, every supplied rule, knowledge paths, observed counts,
  DB review signals and verification contract. Full graph remains inspectable.
  New provider comparisons use `bounded-navigation-v41` in
  `scripts/benchmark-provider-comparison.mjs`; older records remain unchanged.
- [x] Add a source-hashed, no-model comparison script/artifact under
  `docs/evidence/artifacts/v41/` to inspect all twenty pinned public task bases
  from existing mirrors sequentially, compare pre-v41/new graph and projection,
  and record per-task losses as well as aggregate quality/size. Use owned scratch
  directories and remove only their own copies; no company/candidate/cache edits.
  All 20 bases evaluated. Balanced/deep mean Recall@20 unchanged; average nDCG
  improved, but CORS and self-delete rank slightly worse. Fast auth loses one
  gold path within the smaller character/entry window; preserve that result.
- [x] If deterministic checks hold, run a fresh one-call high BTH/direct pair on
  the prepared FastAPI auth task using new output directories, same model and
  protected inputs. Keep old v40 observations unchanged, inspect the actual diff
  and tests, and do not infer a universal speed advantage from one pair.
  Both candidates pass 63 ordinary + 9 independent cases. BTH 224.521s/516506
  tokens; direct 122.054s/231600 tokens. No universal performance benefit.
- [x] Run scoped regression, full relevant QA/package checks and evidence review;
  document remaining goal gaps and publish only reviewed redacted observations.
  Syntax, 592 passing tests with 4 explicit skips, all 42 curated mutation cases,
  and installed package smoke passed. Preserve limits and live-run source hashes.
- [x] Review-discovered regression: `preservationGuidanceFor` uses navigation to
  recognize Java under a custom verification command. Keep its pre-projection
  path input separate from the shortened model list. Fail first with a mixed
  TypeScript/Java request whose Java file lies beyond 24 entries; actual changed-
  Java review must remain independent. Finish and record the frozen live pair
  before this correction, then label the correction's request-level QA separately.
  One regression test failed, then passed with pre-projection guidance paths.
  Full final tests: 596 total / 592 pass / 0 fail / 4 skip. Add two assertion-based
  mutation cases for the new cap and ambiguous-edge behavior in
  `scripts/mutation-smoke.mjs`; record its actual outcome before publication.
- [x] Prepare the reviewed source and redacted evidence for publication. The
  terminal commit/push and remote hash check are a separate final operation; this
  document is not proof of publication. Do not mark the full 3-backend/20-task
  goal complete from this narrower progress.

## Boundaries

No new model/dependency/image installation, real company writes, production DB,
user configuration changes or subagents. Only existing public mirrors and pinned
test dependencies. Read disk/headroom before live work. Do not sacrifice rule
recognition for prompt size. Do not claim all twenty tasks implemented from a
static retrieval benchmark, or actual Windows from local contract tests.
