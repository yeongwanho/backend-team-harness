# Benchmark integrity v18

Date: 2026-08-31

## Corrected third Codex pair

Task: `spring-02-owner-search-whitespace`; Codex 0.151.0, balanced mode,
same pinned task and verification contract as v16. Both lanes changed the two
historical gold paths, passed existing structured verification without a retry,
and recorded no provider-owned validation commands.

| Measurement | BTH | Direct |
| --- | ---: | ---: |
| Implementation plus verification | 122,686 ms | 90,392 ms |
| Provider duration | 67,033 ms | 38,197 ms |
| Total tokens | 162,805 | 111,074 |
| Uncached input | 34,258 | 38,823 |
| Cached input | 125,696 | 70,656 |
| Output | 2,851 | 1,595 |
| Pre-write Recall@5 / Recall@20 | 1 / 1 | 1 / 1 |
| Pre-write nDCG@20 | 0.6934 | 1 |

The BTH request was 26,580 bytes with all four declared rules and nineteen
ranked context entries preserved. The byte reduction is real, but this pair
does **not** show faster implementation or fewer total tokens than direct.
Uncached input was lower; cost was unavailable. No general advantage is claimed.
Raw outputs are not copied into this report. Case records remain under the
local `/tmp/bth-provider-comparison-codex-v3/` evidence directory.

## Stronger success definition

The old schema 2 `successAt1` proved a changed candidate passed existing tests.
It did not independently establish that the requested behavior was implemented.
All v16/v17/v3 run success labels are limited to that old meaning.

Schema 3 keeps this as `verificationSuccessAt1`. Task `successAt1` additionally
requires an evaluator-owned acceptance oracle with valid base/target controls.
Missing acceptance is null, not a pass or a zero substituted for missing data.
Provider/verification failures remain failures. Aggregate final rates stay null
while eligible task outcomes are unmeasured; measured counts are explicit.
Legacy schema results cannot silently acquire stronger meaning on reread.

A regression test first failed on the previous scorer: green existing tests
without acceptance were incorrectly sufficient. The corrected scorer also
covers an invalid control, failed candidate, missing coverage, and legacy data.

## Provider telemetry correction

Claude's reported input excludes cache reads and cache creation. Normalize
total input as all three components; retain cache creation separately from
cache reads. Missing components remain null. Codex input already includes
cache reads. Definition: [Anthropic prompt caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

Invocation telemetry now comes only from complete `turn.completed` (Codex) or
`result` (Claude) events observed before output-tail truncation. Intermediate
assistant usage and numeric fragments are not invocation totals. Fixtures cover
zero, missing components, final-event authority, bounded input, and real process
JSONL collection. The actual Windows fixture has been updated but is not claimed
as executed on this macOS host.

## Remaining work

The task-specific oracle execution and all twenty task acceptance definitions
are still required. These corrections do not complete the product goal.

## Validation

Syntax and diff checks passed. Full suite: 366 tests, 362 passed, 4 explicitly
environment-dependent skips, 0 failures. Coverage: lines 89.79%, branches 78.12%,
functions 98.57%. Three targeted mutations were killed. The installed-package
smoke passed for 0.9.0. Real Windows and DB/JVM opt-in cases remain unexecuted in
this default suite and are not counted as passing.
