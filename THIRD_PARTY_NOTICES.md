# Third-party notices

Backend Team Harness includes or depends on the following third-party software.

## Gradle Wrapper 8.14.3

The runnable example contains Gradle Wrapper scripts and `gradle-wrapper.jar` from the Gradle distribution.

- Project: https://gradle.org/
- License and distribution notices: [`third_party/gradle/LICENSE`](third_party/gradle/LICENSE), [`third_party/gradle/NOTICE`](third_party/gradle/NOTICE)

## fast-xml-parser 5.11.1

Installed as an npm runtime dependency rather than copied into this repository.

- Project: https://github.com/NaturalIntelligence/fast-xml-parser
- License: MIT (included with the installed npm package)

## smol-toml 1.8.0

Installed as a pinned npm runtime dependency for bounded Python project/lock
metadata parsing, rather than copied into this repository. It has no runtime
dependencies of its own.

- Project: https://github.com/squirrelchat/smol-toml
- License: BSD-3-Clause (included with the installed npm package)

## Opt-in MySQL acceptance-test dependencies

The runnable example downloads these dependencies only when its Gradle integration-test configuration is resolved; their binaries are not copied into this repository.

- Testcontainers 2.0.5 (`testcontainers-junit-jupiter`, `testcontainers-mysql`): MIT, https://www.testcontainers.org/
- Flyway Open Source 13.4.0 (`flyway-core`, `flyway-mysql`): Apache License 2.0, https://github.com/flyway/flyway
- MySQL Connector/J 26.7.0: GPLv2 with Universal FOSS Exception, https://github.com/mysql/mysql-connector-j
- MySQL Server Docker image `mysql:8.4.11`: downloaded from the Docker Official Image at test time and not redistributed by BTH
