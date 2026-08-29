# Production-dialect DB integration Pack

This Pack adds a required `db-integration` JUnit gate. The project—not BTH—owns database startup, migration, test data, and teardown.

The installed Gate declares network use. Testcontainers, Compose, wrappers, and dependency resolution can download artifacts, so `bth check --allow-network` or `bth verify ... --allow-network` is required after review. This approval flag is not a firewall.

Before running it, make the generated command real:

- Gradle: define `integrationTest` and emit JUnit under `build/test-results/integrationTest/`.
- Maven: define the `db-integration` profile and run Failsafe during `verify`.
- Use the same database dialect and relevant major version as production, normally through Testcontainers or the project's existing Compose lifecycle.
- Apply every migration from an empty database and test upgrade paths that matter.
- Prove containers/processes are removed after success, failure, and timeout.
- Keep credentials synthetic. Never point the Pack at production.

The first reference path is MySQL 8.4 LTS. For a Gradle/JUnit project, use a pinned MySQL image, Testcontainers' MySQL and JUnit Jupiter modules, the official Connector/J driver, and Flyway's MySQL module. The runnable repository example shows the complete wiring. Keep the project's production MySQL major version authoritative if it differs from the reference fixture.

The Pack does not add a second hidden database lifecycle and does not claim that H2 or SQLite proves MySQL migration safety.
