# Two more source-bound regression controls v24

2026-08-31. Independent behavior controls now cover **5/20 tasks**, up from three.
No provider was invoked here; these are evaluator readiness results, not five
AI implementation successes. The full three-backend/twenty-task goal remains active.

## Real behavior tested

| Task | Before change | Pinned target | Surface |
|---|---|---|---|
| spring-05-binder-id-protection | Two assertion failures, one controller exception, two passing validation checks | 5/5 pass | Standalone MockMvc HTTP requests through real owner/pet/visit controllers; repository mocks |
| spring-06-pet-update | Existing-pet persistence assertion fails; three other checks pass | 4/4 pass | Real JPA and explicit in-memory H2, flushed and cleared before reload |

Binder tests attempt to overwrite direct IDs and nested pet/type IDs. They also
assert that ordinary name/date/address fields still bind and that required pet
name/type validation remains active. The visit exception on the base is triggered
by the poisoned association ID; it is not a build/dependency failure. This is a
binding-contract test, not a general security certification.

Pet-update tests prove the new name, birth date and type survive database flush
and reload without adding another pet. They preserve the existing fallback for
a new unsaved pet and check that duplicate names and future birth dates do not
alter stored state. The controller is invoked directly for these JPA checks;
HTTP binding is not claimed for this task. H2 is explicit, with its driver and
schema/data scripts bound in the test annotation and rollback per test. No MySQL,
concurrency, deployed upgrade, or production-database safety claim follows.

The test fixtures contain checks only, not production implementation. They are
injected into evaluator-owned base/target/candidate clones and pinned by SHA-256.
They are not handed to the implementation provider. Source fingerprints remained
unchanged during both runs. Missing, duplicate, skipped or unexecuted named tests
cannot establish success, and compiler failures are not regression evidence.

## Reproduction and evidence

The final direct controls call `evaluateTaskAcceptance` with the corpus task,
configured acceptance object, `fixtureRoot=benchmarks/public-backend-v1`, the
local public Spring mirror, and a 180000 ms per-process bound. Its exact commands,
case names, fixture hashes and pins are in the checked-in provider comparison
configuration. Both commands use offline Maven. Dependencies must first be
available; offline does not mean OS-level network isolation of arbitrary code.

Persistent [acceptance-controls.json](artifacts/v24/acceptance-controls.json)
contains the final whole-config hash, both full task pins, per-case outcomes,
source stability, durations and output/report hashes. It contains no raw SQL,
rendered pages, environment values or company source. Source commit 41b5e63 is
the parent; new fixture hashes and the configuration hash bind this uncommitted
evaluation checkpoint. Production evaluator/runtime source was not changed here.
Artifact SHA-256:
`f8c242fe85441d4b24924358d04e09e3601586002d1360d14df05684ef445440`.
The final direct binder/pet control runs took 32018 / 53135 ms respectively;
these are validation times, not AI implementation latency.

The public preparation path was also exercised:

```sh
node scripts/benchmark-provider-comparison.mjs --preflight \
  --task spring-05-binder-id-protection --output /tmp/bth-v24-binder-preflight \
  --cache /tmp/bth-provider-comparison-cache-v2 --timeout-ms 300000 --allow-network

node scripts/benchmark-provider-comparison.mjs --preflight \
  --task spring-06-pet-update --output /tmp/bth-v24-pet-preflight \
  --cache /tmp/bth-provider-comparison-cache-v2 --timeout-ms 300000 --allow-network
```

The binder preflight confirmed normal **59/59** tests and its regression controls,
with 160651 ms preparation time. It ran before the other task's fixture API
correction, so its whole-config hash is older; the final direct two-task controls
bind the current config. Preparation time is not provider implementation latency.
The pet preflight confirmed normal **56/56** tests and its regression controls,
with 208228 ms preparation time. Both reported ready for a future provider
comparison and removed their owned workspace. Compact results are retained in
[preflight.json](artifacts/v24/preflight.json); they contain hashes, not raw output.

Failed attempts were retained as failures: initial fixture formatting did not
match each pinned project's formatter; the Spring 3.4.2 parent was absent from
the offline cache; and the first pet fixture incorrectly assumed the newer
PetTypeRepository/constructor API. The old commit uses OwnerRepository for types.
Only the evaluator fixture was corrected, formatted and rehashed. Dependency
preparation ran in temporary public clones; no company source was modified.

## Harness regression QA

Final `npm run test:coverage`: **403 tests, 399 passed, 0 failed, 4 skipped**;
coverage **90.21% lines, 79.40% branches, 98.77% functions** on Node v22.23.1,
macOS arm64. `npm run test:install`, syntax and diff checks passed. The affected
config/acceptance/benchmark-script tests separately passed **16/16** after final
fixture/API/hash corrections. Fixture hash tests ensure evaluator checks stay
outside provider decisions and match pinned bytes. Documentation contract tests
are rerun after the final README update.

The four default-suite environment skips still cover opt-in JVM/MySQL and actual
Windows cases; they are not passes. The real JVM runs above prove their stated
Spring/H2/HTTP surfaces only. Runtime source did not change in v24; v23's eight
passing-baseline mutation controls remain historical evidence, not a newly run
repository-wide mutation score.

## Remaining gap

Fifteen independent task oracles and the full paid provider matrix still remain.
Only two distinct tasks have earlier successful Codex paired implementation runs;
this checkpoint adds none. The TypeScript/Python DB execution environments,
retrieval misses, real Windows cases and comparable efficiency evidence remain
unfinished. More passing test controls must not be presented as production readiness.
