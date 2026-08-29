# Gitleaks secret scan Pack

This Pack executes the locally installed `gitleaks` CLI against the current working tree. It requests fully redacted JSON, discards secret-bearing fields, and writes only rule, description, file, line, and a one-way fingerprint to the BTH findings contract.

Prerequisite: install the open-source Gitleaks CLI and make `gitleaks` available on `PATH`. BTH does not download binaries or use the separately licensed Gitleaks GitHub Action.

The `secrets` gate is required and `high`/`critical` findings block verification. It still cannot create PASS: required executed JUnit tests remain mandatory.
