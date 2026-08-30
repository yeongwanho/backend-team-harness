# API and message contract Pack

This Pack adds a required contract-test JUnit gate.

Connect the project-owned contract mechanism: Pact, Spring Cloud Contract, OpenAPI compatibility tests, protobuf/schema compatibility, or message fixtures. The generated Gradle command expects `contractTest`; the Maven command expects a `contract-test` profile using Failsafe and directs XML to `target/bth-reports/contract/`.

Cover consumer-visible success and error behavior. Do not send real credentials or production payloads into fixtures.
