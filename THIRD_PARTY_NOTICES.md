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

## Spring Petclinic integration-test fixtures

The evaluation-only `benchmarks/public-backend-v1/fixtures/spring/` versions of
`MySqlIntegrationTests.java`, `MysqlTestApplication.java`, and
`PostgresIntegrationTests.java` are adapted from Spring Petclinic at
`0f6e8614047bd74cf6223b4d8a858d2ed2824f8a`. Copyright and Apache-2.0 headers are
preserved. Only database provisioning is changed: cached exact images, loopback
ports, temporary data, per-run ownership and no optional Docker skips. Original
test methods and assertions remain unchanged. `BthDatabaseFixture.java` is an
evaluation helper added by BTH. License text: `third_party/spring-petclinic/LICENSE.txt`.

## FastAPI full-stack template test fixtures

The evaluation-only `benchmarks/public-backend-v1/fixtures/fastapi/test_utils.py`,
`test_backend_pre_start.py`, and `test_test_pre_start.py` adapt test helpers from
`fastapi/full-stack-fastapi-template` at
`fe3bafc6f6732698ed2c58424f64065a4209ad47`. Changes fix imported mock bindings,
assertions and synthetic email addresses; production application code is not
bundled. Original [source and license](https://github.com/fastapi/full-stack-fastapi-template/tree/fe3bafc6f6732698ed2c58424f64065a4209ad47).

MIT License

Copyright (c) 2019 Sebastián Ramírez

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
