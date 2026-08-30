# One-task fast implementation comparison v22

2026-08-31. Runtime source: `35d827d`. This is one paid Codex pair, not completion
of the three-repository/20-task goal or evidence of an efficiency advantage.

Both lanes used explicit `gpt-5.6-sol`, `fast` (low effort), one attempt,
`spring-01-pet-association`, the same pinned base, normal verification, and the
same independent acceptance oracle. BTH ran first, direct Codex second, on one
workstation. No heavy local QA ran concurrently. Dependency/provider cache order
is not controlled; repeat/order-balanced trials are needed for causal claims.

```sh
BTH_PROVIDER_BENCHMARK=I_UNDERSTAND_PROVIDER_COSTS \
node scripts/benchmark-provider-comparison.mjs --execute \
  --provider codex --lane both --task spring-01-pet-association \
  --output /tmp/bth-provider-codex-fast-v22 \
  --cache /tmp/bth-provider-comparison-cache-v2 \
  --model gpt-5.6-sol --mode fast --timeout-ms 900000 --allow-network
```

Reproduction requires a fresh output directory, provider authentication and
explicit cost acknowledgement. Network acknowledgement is not egress isolation.

| Observation | BTH | Direct Codex |
|---|---:|---:|
| Independent task acceptance / normal verification | pass / pass | pass / pass |
| Attempts / retries / observed rule violations | 1 / 0 / 0 | 1 / 0 / 0 |
| Implementation + normal verification | 146.341 s | 144.557 s |
| Provider invocation | 89.925 s | 89.904 s |
| Entire case, including setup, preflight and oracle | 284.020 s | 282.471 s |
| Independent oracle | 28.033 s | 32.702 s |
| Total tokens | 286,654 | 283,135 |
| Uncached input tokens | 112,279 | 44,767 |
| Cached input tokens | 170,496 | 234,496 |
| Output tokens | 3,879 | 3,872 |
| Reported cost | unavailable | unavailable |

Both changed exactly the four expected paths. In separate acceptance clones, the
base reproduced three assertion failures, the historical target passed all four
named checks, and each candidate passed all four. Source-stability checks passed
and the implementation candidate remained untouched by acceptance execution.
This proves those named behaviors, not exhaustive boundary/concurrency correctness.

BTH took 1.23% longer and used 1.24% more total tokens in this single pair. There
is no demonstrated speed or token advantage. Its uncached input was substantially
higher, but the sequential cache order prevents attributing that gap entirely to
the harness. Missing dollar cost is `null`, not zero. The earlier whitespace pair
used a different task/model-selection/mode; do not pool them as identical trials.

## Retrieval evidence and next experiment

BTH supplied seven code-context entries in 1,998 characters, plus four project
rules. Its 19,677-byte request is not equivalent to total provider input: provider
tool iterations dominate that total. Initial supplied-file Recall@5 was 0 and
Recall@20 was 0.25. Final changed-file recall was 1; outcome localization must not
be substituted for pre-implementation impact localization.

Direct's event-derived pre-write paths also had recall 0, but that observer does
not capture every nested code-mode read. This is incomplete observed evidence,
not proof that Codex never read the relevant files.

The current retrieval query appends operational plan text to the requirement.
Requirement-only static ranking looked better, but used a different budget. The
next experiment must hold graph and 2,000-character budget fixed before changing
query construction. Approved rules and instructions must remain in the provider
payload even if retrieval text is narrowed.

## Durable evidence / remaining scope

[Full structured records](artifacts/v22/codex-fast-pair.json), SHA-256
`e30f4f038f4cfad7dd7247ad38346e8c38303b423a4aac4fa9293f754577c971`.
The artifact binds corpus/config/model/mode/base/target, test outcomes, hashes,
usage and timings; it contains no raw model transcript or company source.

Three of twenty tasks have control-verified acceptance oracles; two distinct
tasks now have acceptance-confirmed Codex pairs. Seventeen oracles, safe Node/
Python service setup, the full paired matrix and Claude comparisons remain.
No new Claude call was attempted at this checkpoint; its earlier rate limit is
not a quality failure. Windows, company DB readiness, lower cost and superiority
to other harnesses are not demonstrated by this result.
