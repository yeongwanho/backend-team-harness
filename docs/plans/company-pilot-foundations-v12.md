# Company-pilot foundations v1.2

## Goal

Repair first-run trust failures found by an independent private-repository pilot before adding more automation features.

## Acceptance criteria

1. `intelligence inspect --no-cache` works without `.backend-harness/verification.json` and performs no project write.
2. Missing contracts and inferred defaults are visible as `unknown`, never as healthy or confirmed verification.
3. Gradle and Maven defaults require a project-owned wrapper and bind detected module build files and module-owned JUnit report directories.
4. `doctor` rejects a JUnit contract that omits a detected test module.
5. `doctor` compares the active Java runtime with the Gradle wrapper compatibility range and Maven 3.9+/4.x minimum Java requirements from official documentation.
6. The CLI does not imply network isolation that the process runner does not enforce.
7. Existing implementation-provider and verification behavior remains compatible, including the legacy schema-v1 adapter contract.
8. First-run build discovery reuses one manifest/detection pass and fails closed at bounded file and byte limits.
9. A compatible single-module CRUD change may select the bounded fast implementation profile, while migration, compatibility risk, and unknowns still escalate.
10. A provider that produces no source change stops after one call and runs neither Gates nor blind recovery.

## Files

- `src/core/jvm-build-discovery.mjs`: bounded build/module/framework/wrapper/JVM discovery.
- `src/config/verification.mjs`: module-aware inferred verification.
- `src/adapters/project-context.mjs`: bootstrap-free inspection context.
- `src/adapters/project-intelligence.mjs`: truthful overall status.
- `src/doctor.mjs`: compatibility and verification-coverage checks.
- `src/init-project.mjs`: detection-backed initial documents.
- `src/cli.mjs`, verification/runtime records, and docs: explicit network-risk language.
- `test/company-pilot-foundations.test.mjs` and adjacent regression suites: failing-first coverage.

## Non-goals

- No automatic project writes during inspection.
- No operating-system firewall claim.
- No model verdict authority.
- No private repository names, paths, source, policies, or credentials in committed evidence.
- No new agent, dashboard, or unrelated feature.
