# Provider comparison v16 checkpoint

Date: 2026-08-31  
Branch: `codex/company-pilot-p0`

## Goal

Measure whether `bth work` improves one-shot backend implementation over using the same Codex or Claude CLI directly. Completion requires three independent public backends and twenty versioned tasks. The paired measures are success@1, rule violations, pre-write impact Recall/nDCG, outcome path coverage, elapsed time, provider tokens/cost, and retry rate.

## First real paired observation — negative baseline

Task: `spring-02-owner-search-whitespace`  
Provider: Codex CLI 0.151.0  
Mode: balanced  
Base verification: Maven offline verify, 71/71 tests passed

| Measure | BTH | Direct |
| --- | ---: | ---: |
| success@1 | true | true |
| changed gold paths | 2/2 | 2/2 |
| post-change tests | 71/71 | 71/71 |
| elapsed | 219,153 ms | 151,656 ms |
| total tokens | 1,037,120 | 865,623 |
| cached input | 945,152 | 799,232 |
| output | 4,976 | 4,932 |

The first pair does **not** support a performance advantage claim. BTH was 67,497 ms slower and reported 171,497 more total tokens. Cost was unavailable and remains `null`.

The old direct localization value was invalid because it scored post-change paths as if they were pre-change impact analysis. It must not be used. This checkpoint replaces that ambiguous field with:

- `impactLocalization`: only pre-write paths observed from provider events or deterministic BTH code context; otherwise `null` with coverage;
- `outcomeLocalization`: actual post-change paths for both lanes.

## Changes made before the next paid run

- split cached input from derived uncached input instead of comparing only provider total input;
- stop asking providers to reread every declared policy document;
- require providers to inspect the ranked production path and its paired test first;
- co-select one uniquely resolved production/test graph pair inside the existing character budget;
- forbid provider-owned build/test/formatter/linter/package-manager/Docker/database commands because BTH runs the authoritative Gates;
- derive only bounded path and command-category activity from Codex JSONL or Claude stream JSON; raw output and source content are not persisted;
- record evaluator-owned validation by a provider as `provider-ran-evaluator-owned-validation`;
- clean the isolated BTH worktree in `finally` even when a benchmark run fails;
- keep direct impact metrics unmeasured until event evidence exists.

The Codex event collector follows the tagged `rust-v0.151.0-alpha.9` `codex exec --json` contract (`command_execution`, `file_change`, `turn.completed`) rather than parsing prose. Unknown or oversized events are counted and ignored.

## Verification

```text
npm run check
361 tests: 357 passed, 4 environment-dependent skipped, 0 failed
mutation smoke: 3/3 targeted mutations killed
```

The coverage gate also passed at lines `89.71%`, branches `77.93%`, and functions `98.55%`. Claude stream-event fixtures now cover pre-write reads, writes, cache input, uncached input, output, cost, and bounded activity evidence. A benchmark regression proves that provider-owned validation is recorded as a rule violation rather than hidden inside an apparently successful run.

The pinned public localization corpus was rerun across all three repositories and twenty tasks after production/test pair co-selection:

| Measure | Previous | Current |
| --- | ---: | ---: |
| mean Recall@5 | 0.3682 | 0.4390 |
| mean Recall@20 | 0.7075 | 0.7200 |
| mean nDCG@20 | 0.4908 | 0.5042 |
| zero-Recall@20 tasks | 0 | 0 |

This improves the deterministic impact-localization stage. It does not yet prove that paid implementation is faster or cheaper.

This is a checkpoint, not goal completion. The next step is to rerun the same paid Codex pair and compare it against this negative baseline before expanding to Claude or all twenty tasks.
