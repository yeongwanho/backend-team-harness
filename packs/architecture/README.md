# Executable architecture Pack

This Pack adds a required JUnit gate for architecture tests in a dedicated report directory.

- Gradle: define an `architectureTest` task and emit JUnit under `build/test-results/architectureTest/`. Copy the matching `gradle-*-dsl.snippet` from this installed Pack into the project build file, then adapt both matching filters if needed. The snippet excludes those classes from the ordinary `test` task to prevent duplicate execution.
- Maven: the generated command selects `*ArchitectureTest` and redirects Surefire XML to `target/bth-reports/architecture/`.

The dedicated output is required: sharing the ordinary `test` report directory with two Gates would make fresh evidence ambiguous and is rejected.

Add project-owned tests using ArchUnit, Spring Modulith, or ordinary reflection/compile tests. Good rules assert dependency direction, module boundaries, forbidden package access, transaction placement, and adapter/domain separation. Keep exceptions explicit in source control.

The gate passes only when those tests really execute. A generated package diagram or an AI opinion is not architecture evidence.
