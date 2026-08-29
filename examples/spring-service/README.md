# Synthetic Spring service fixture

This directory contains company-free, synthetic backend structure used to demonstrate init, doctor, and the generated verification contract. It intentionally has no checked-in Gradle Wrapper or test dependency, so `doctor` reports that verification is not executable yet rather than pretending the fixture is verified.

Run from this directory:

    node ../../src/cli.mjs doctor .

Use the real JVM acceptance test from the repository root when Maven and Gradle are available:

    BTH_REAL_JVM_E2E=1 node --test test/jvm-real-e2e.test.mjs
