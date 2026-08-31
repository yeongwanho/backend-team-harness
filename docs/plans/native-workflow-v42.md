# v42 — measure one complete workflow, not only one edit call

Previous turn: progress, ea0eb6f pushed. The real v41 pair passed its task but
BTH was slower and used more reported tokens. No full-goal completion claim.

## Evidence and boundaries

`provider-benchmark-runner.mjs` bans validation in both lanes and pins one call.
`model-cli.mjs` additionally removes Claude's Bash tool. `scoreProviderCase`
counts provider invocations as first-attempt success; that cannot describe a
native CLI session that tests and repairs internally. Retain that historical
editing protocol and never mix it with new whole-workflow results.

The new opt-in native-workflow comparison gives the direct CLI the prepared,
immutable required verification commands, while BTH keeps its normal managed
test/recovery loop. It is still an isolated, approved-task comparison, not an
unrestricted personal CLI configuration. It does not grant production/network
isolation guarantees. No user settings, company source, deployment or candidate
application. Public mirrored fixtures only; retained candidates stay intact.

## Edit plus verification units

- [x] Add `src/evaluation/workflow-budget.mjs` with unit tests: shared measured
  provider wall-time and reported Claude dollar budget over bounded BTH calls;
  unknown required cost prevents a further call, exhaustion never starts a
  provider, and all original usage remains visible. Direct receives the same
  total ceiling. Tests use injected clocks/runners, not paid calls.
- [x] Extend the direct provider prompt invocation in `src/providers/model-cli.mjs`
  only for explicit evaluation validation commands. Default BTH tool restrictions
  remain unchanged. Claude receives Bash with exact prepared command approval,
  never global Bash approval. Validate command tokens before generating permission
  rules. Test positive and malformed command cases and preserve test authoring.
- [x] Extend `src/evaluation/provider-benchmark-runner.mjs` and runner tests:
  native direct may run prepared gates and repair; BTH uses its existing bounded
  recovery. Both still receive evaluator-owned final structured verification and
  independent acceptance. Record version, model, profile, model calls, budget and
  timing boundaries. A provider's claimed test success never grants a verdict.
- [x] Extend comparison metrics/tests with an explicit success unit. Native
  success@1 means one top-level workflow request, not one patch/model call.
  Internal direct repairs are unknown, not zero. Reject mixed success units.
  Retain controlled-edit metrics unchanged and disclose invocation vs repair counts.
- [x] Extend benchmark CLI/tests with `--workflow` and bounded `--max-attempts`;
  separate protocols and hash timeout/cost/recovery policy for resume/aggregation.
  Plan mode remains read-only and reports maximum model calls. Explicit network
  and cost acknowledgements remain mandatory.
- [x] Run scoped regression, then a new real public Codex pair with fixed source,
  prepared tests, model/high effort, total provider allowance and immutable oracle.
  Inspect real diffs/usage/commands and record failures as failures. Do not tune
  prompts after seeing a candidate without retaining the original outcome.
- [x] Record evidence under `docs/evidence/artifacts/v42/` and a human report;
  update README/CHANGELOG. Run full regression/coverage, installed smoke and
  assertion-based mutation checks as appropriate; commit/push only verified work.

Native Claude support must be tested at the invocation boundary; a real Claude
run is separate evidence, never inferred from Codex. Windows/MySQL and the other
unexecuted corpus tasks remain full-goal gaps. Keep the 3-backend/20-task goal active.

## Live-review finding

Both real Codex candidates passed 63 ordinary + 9 independent cases. Direct's
validationCommandCount is zero. Whether the model skipped its test command or
the tracer missed it is unproven; do not claim a verified native baseline.
Preserve the original sealed pair, then add explicit successful-completion
observations for prepared commands (including equivalent `./` spelling). A
green independent evaluator alone must not prove direct native validation.
Re-score the old observation as unknown, not silently as a successful full flow.
Post-comparison source hashes and QA must be separately labeled. No new model
call can be inferred from re-scoring or process-event fixture tests.

## Final observation-boundary review

- [x] Add failing cases in `test/validation-activity.test.mjs` for skipped commands,
  swallowed exits, echo/prose, substitutions, and compound shell scripts. Tighten
  `src/providers/validation-activity.mjs` to recognize only literal complete
  approved invocations, optionally wrapped by a known shell's `-c`/`-lc` argument.
  Ambiguous compound scripts remain unobserved, never successful. Rerun scoped
  tests, full coverage, mutations and installed smoke; re-seal only the corrected
  audit and final QA, preserving the original real pair artifact untouched.

Observer correction and scoped verification: 54 passed. Original real pair is
preserved, direct completion re-scored as unknown. Final full QA: 612 tests,
608 passed, zero failed, four genuine environment skips; 46 curated mutations
killed with assertion evidence; installed-package smoke and syntax passed.
This is not a new real model run or completion of the 3-backend/20-task goal.
Evidence and changes are ready for the verified progress commit/push.
