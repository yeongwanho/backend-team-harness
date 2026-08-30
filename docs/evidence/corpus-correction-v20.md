# Corpus requirement correction v20

Date: 2026-08-31

The previous `spring-04-future-visit` requirement incorrectly said to reject
future dates. Its pinned target does the opposite: a new visit defaults to
tomorrow, the form minimum is tomorrow, and the controller rejects a non-null
date unless it is after today. The target test accepts tomorrow and rejects
today. The requirement is now corrected to describe that actual behavior.

The binder task was also incorrectly named an allowlist. The target adds `id`
and `*.id` to disallowed fields, not an allowlist of mutable fields. Its task ID
is now `spring-05-binder-id-protection`, and the requirement states the actual
identifier-binding boundary. The pet-update requirement now includes birth date
and the existing new-pet fallback. The MySQL requirement names the concrete
create-user/grant split instead of promising compatibility with every future
MySQL release. None of these tasks had a paid provider run.

Evidence: [`VisitController` at the pinned target](https://github.com/spring-projects/spring-petclinic/blob/753d35c2f84432d88c0f3b61c9302a16069b78dd/src/main/java/org/springframework/samples/petclinic/owner/VisitController.java),
[`VisitControllerTests`](https://github.com/spring-projects/spring-petclinic/blob/753d35c2f84432d88c0f3b61c9302a16069b78dd/src/test/java/org/springframework/samples/petclinic/owner/VisitControllerTests.java).

The prior 20-task localization averages remain historical results from the old
task text, not the corrected corpus's current scores. This task has not been
used in a paid implementation comparison. The Spring owner-whitespace task and
its existing paired results are unaffected by the wording correction.

New corpus loads compute a SHA-256 for the exact corpus file and every normalized
requirement. Provider configuration loads also compute their exact input hash.
Plan, case, preflight, static evaluation, and summary outputs carry the relevant
fingerprints. Resume and aggregation refuse missing or mismatched corpus/config
fingerprints, effort mode, and explicit model selection. A changed requirement
can no longer silently reuse old records under the same corpus ID.

The default model can still change behind a provider's unpinned alias; this
metadata does not certify exact model weights or eliminate historical-task
training contamination. Completing the source/requirement audit for all twenty
tasks and rerunning the corrected corpus are still necessary.

Validation: syntax/diff checks passed; 378 tests, 374 pass, 4 environment-dependent
skip, 0 fail. Coverage: lines 89.94%, branches 78.51%, functions 98.60%. Three
targeted mutations killed; installed-package smoke passed. The additional
contracts prove changed task text changes its fingerprint, unchanged tasks retain
theirs, mismatched comparison inputs are rejected, and legacy preflight readiness
is rejected before any clone or test execution. Full log: local
`/tmp/bth-corpus-v20-coverage.log`.

Next acceptance work: finish the per-task source/requirement audit, provide the
remaining nineteen behavioral oracles (including safe MySQL fixtures), and run
the corrected corpus. The single accepted Codex pair in v19 did not establish a
token or speed advantage. Small-task provider-request overhead still requires
improvement and measurement; Claude remains rate-limited in this environment.
