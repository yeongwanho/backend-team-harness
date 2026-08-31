# v46 — Native work on the next fixed-corpus Spring task

## Objective and evidence

Continue the unchanged three-backend/twenty-task goal. The prior v45 turn was
progress: committed runtime fixes, real controls and Git round-trip evidence.
Start from `12dfc63a2dcb822414594f7158a3e242cd822b25`, clean branch
`codex/company-pilot-p0`. About 564 MiB is available. Nest's retained dependency
trees still do not fit; do not delete user data, caches or prior candidates.

Take the first not-yet-native-executed task in the fixed corpus:
`spring-01-pet-association`, base `88e37c15cf6fc8490b01bc3e8e2c800cec1ac272`,
target `676db04515ee5f289641cea6cb379dc02b40f67f`. This does not remove or
redefine any of the remaining tasks. Its POM and three test provisioning files
are unchanged from the already verified Spring search baseline. MySQL 9.7 and
PostgreSQL 18.4 image IDs match the cached v44 images. Maven remains offline,
with the entire verify lifecycle, format/checkstyle and real DB tests retained.

The current oracle copies four upstream cases. It does not distinguish a
different Pet object with the same persisted ID, or the 30/31 boundary. Replace
it with an independent behavior fixture before inference, preserving the exact
requirement text and SHA. Do not require unspecified null-pet handling, new error
messages, Unicode semantics or a particular implementation algorithm.

## Atomic plan

1. Add `fixtures/spring/PetAssociationAcceptanceTests.java`: persisted association,
   same-object and same-ID deduplication, separate new/persisted pets, 30 vs 31
   ASCII name length, and existing name/type/birth-date required rules. Invoke
   actual Owner/PetValidator; no app bootstrap or DB is needed for this oracle.
2. Update only spring-01 in `provider-comparison.json`: hash-pin the oracle and
   all named cases; reuse the byte-identical seven-file Maven/DB fixture with
   exact original preimages. Pin the baseline test minimum before inference.
3. Extend public Spring fixture contract tests for the new task and oracle hashes.
   Verify actual source preimages and unchanged original integration test bodies.
4. Run model-free preflight, whole Maven verify and independent base/target
   controls serially. Remove only this turn's disposable preflight directories.
   Setup failures or missing test execution are not behavioral regressions.
5. Seal source hashes and run one real BTH/direct Codex pair: native workflow,
   explicit fast/low profile, gpt-5.6-sol, shared 240s provider budget, BTH at most
   three invocations/direct one session. Retain source candidates and terminal
   raw observations; no manual correction of scored candidates.
6. Inspect final source, protected inputs, full verification source fingerprint,
   independent candidate results, changed files, rules and usage. If a runtime
   defect blocks work, add a failing reproduction, fix it and keep earlier scores
   immutable; a separate diagnostic/replay cannot replace the original trial.
7. Record source-bound results and remaining scope under v46, rebuild the corpus
   ledger without pooling different protocols, run proportionate regression and
   publish the verified commit. No twenty-task or speed/token superiority claim
   from one task. Actual Windows, full company-policy understanding and complete
   interview accuracy remain outside what this particular experiment proves.

## Newly observed follow-up (original trial remains immutable)

The Spring candidate has no `.backend-harness/.gitattributes`: v45's byte-preserving
template is only emitted for portable Node/Python verification. The repository's
`*.cmd text eol=crlf` can therefore transform Maven fixture contract bytes at a Git
checkout. Reproduce this without a model before changing runtime code. Once the
original pair is sealed, make the same template common to all init paths, include
it in generated verification inputs, and verify fresh Git snapshots under root
attributes and autocrlf input/true/false. Preserve existing team-owned attributes
by default and test force backups and symlink refusal. Keep scored candidates and
their original outcome unchanged. Post-fix tests are not a new paid model trial.

Also challenge the new oracle using five deliberately wrong disposable target
snapshots (same object, same ID, null IDs, 29/31 length bounds). Count only the
intended assertion failures; no provider calls and no scored candidate mutation.

## Safety/resource bounds

No company repository changes, production DB, provider setting changes, package
publish, full-history duplication or shared-cache deletion. No new Docker image
pulls. Use existing owned-loopback/tmpfs DB fixture and record its limited egress
guarantee. Keep dependency-heavy validation serial with model timing. If disk
headroom falls below what an owned stage needs, stop that stage with an unknown
result rather than weakening tests or deleting someone else's data.
