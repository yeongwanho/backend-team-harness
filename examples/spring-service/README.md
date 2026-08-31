# Runnable JVM backend service fixture

This directory contains a company-free backend structure with a checked-in Gradle Wrapper, real JUnit unit tests, and an opt-in MySQL 8.4 Testcontainers + Flyway integration test. It demonstrates `doctor`, explicit network approval, fresh JUnit ingestion, source-bound run records, and how a project owns its database lifecycle.

Run from this directory:

    node ../../src/cli.mjs doctor .
    node ../../src/cli.mjs intelligence inspect .
    node ../../src/cli.mjs check . --allow-network

`intelligence inspect` shows source-bound facts and the checked-in project-rule results. The example deliberately leaves `databaseDialect` unknown in its unit-test Gate, so the Flyway dialect rule remains a non-blocking warning until the DB Pack configures the real MySQL integration Gate. The implementation adapter is disabled by default and cannot write code until a project explicitly supplies its own reviewed wrapper and write budget.

The network flag is required because Gradle Wrapper and Maven Central may be contacted on a cold machine. After the distribution and dependencies are cached, the project can choose an offline command in `verification.json`.

Use the real JVM acceptance test from the repository root for the cross-build-tool fixtures:

    BTH_REAL_JVM_E2E=1 node --test test/jvm-real-e2e.test.mjs

The normal example Gate runs only unit tests. To prove the DB Pack against Docker without changing this checked-in example, run the repository acceptance test:

    BTH_REAL_DB_E2E=1 node --test test/db-real-e2e.test.mjs

That test copies this service into a temporary Git repository, installs `db-integration`, declares MySQL as the intended dialect, and runs both Gates through BTH. It applies a real Flyway migration using MySQL-specific `JSON`, `ENUM`, InnoDB, and `utf8mb4` behavior. It also proves removal of the pinned `mysql:8.4.11` Testcontainers container after success, an assertion failure, an abrupt test-process failure, and a BTH timeout. It never contacts an operating or company database.

The MySQL image must already be cached: the test does not pull it. Database files
use a bounded temporary memory mount. Every run gives its container a unique
owner UUID; fallback cleanup verifies that label, full container ID and expected
image ID. A different developer's same-image container is never a cleanup target.
MySQL uses a random test password and a dynamically allocated loopback-bound
port; the real test asserts the observed port binding. This is not an outbound
network sandbox for Gradle or the container.
