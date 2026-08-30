# Provider request context v17

Date: 2026-08-31

## Measured problem

The real `spring-02-owner-search-whitespace` Codex pair used a 52,340-byte BTH implementation request. A provider-free diagnostic at the same pinned base reproduced that size. The largest fields were project conventions (30,133 pretty-printed bytes), code context (12,637 bytes), and approved task text (6,230 bytes).

## Change

- Preserve every normalized declared rule, unknown/blocking status, approval text, permission boundary, ranked code entry, and source provenance.
- Select source-pattern examples by ranked task relevance: 1/2/4 examples per group and 2/4/8 test pairs for fast/balanced/deep.
- Preserve convention counts, naming patterns, roles, database authority limits, and explicit omission counts.
- Omit model-irrelevant graph convergence/global-size telemetry and bound duplicate dependency path lists.
- Serialize provider requests as compact JSON; legacy command requests and human-facing artifacts retain their existing format.

## Observed size

The same pinned task, same balanced mode, and same source tree produced:

| Request | Bytes |
| --- | ---: |
| Original | 52,340 |
| Selected examples, pretty JSON | 35,792 |
| Selected examples, compact JSON | 26,580 |

That is a 49.2% request-byte reduction. All four declared rules and all nineteen ranked context entries remained. Thirty-one redundant examples and five test pairs were omitted from the model-facing projection, not from the source-bound interview snapshot.

The projection regression tests prove preservation of declared blockers/authority, source provenance, ranking, input immutability, mode budgets, explicit omission counts, and request serialization. The implementation-orchestrator regression suite remains green.

Full validation passed: syntax check; 364 tests (360 pass, 4 environment-dependent skip, 0 fail); coverage lines 89.76%, branches 77.86%, functions 98.56%; three targeted mutations killed; installed-package smoke. The real MySQL/JVM and Windows environment cases remain explicitly skipped in the default suite.

## Not proven

Request bytes are not total provider tokens. Provider system prompts, tools, cache behavior, reasoning, and additional reads remain outside this byte reduction. A corrected real paired run is required before claiming a time, token, or cost advantage. This checkpoint does not complete the three-repository/twenty-task goal.
